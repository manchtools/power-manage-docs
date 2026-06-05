---
title: CA rotation
---
# Root CA rotation

Power-manage has one CA root today: the value of `CONTROL_CA_CERT` / `CONTROL_CA_KEY`. It signs:

- Every agent's client certificate (used for mTLS into the gateway).
- The gateway's own server cert.
- The control server's `InternalService` cert.

> **The HTTPS cert on Traefik is independent.** That's whatever issuer you use for `control.<your-domain>` (Let's Encrypt, an internal PKI, etc.) — it does *not* chain to `CONTROL_CA_CERT`. Rotating Traefik's cert is your existing TLS-cert workflow; it has nothing to do with this page.

There is no `RotateRootCA` CLI command or RPC. Rotation is a deploy-time procedure built around the **trust bundle** primitive: `SetTrustBundle` accepts a PEM with multiple CA certs, so during a rotation window both the *old* root and the *new* root are trusted simultaneously. That window is what lets agents migrate without a hard cutover.

## When to rotate

- The CA key is suspected to have leaked (host compromise, accidental backup, departing operator with disk access).
- Compliance-driven rotation (annual or triennial, depending on your regime).
- The CA's algorithm or key size no longer meets your standard (e.g. moving from a 2048-bit RSA root to a P-256 ECDSA root).
- The CA cert is approaching expiry. Default lifetime from `setup.sh` is multi-year; check `openssl x509 -in deploy/certs/ca.crt -noout -dates`.

Routine rotation "just because" isn't recommended — it's a non-trivial procedure and every issued agent cert has to renew under the new root before the old one drops.

## The procedure

The flow has four phases. Don't compress them — the overlap window is what gives you a rollback path.

### Phase 1 — Mint the new CA

On the deploy host:

```bash
# back up the existing root
cp deploy/certs/ca.crt deploy/certs/ca.crt.old
cp deploy/certs/ca.key deploy/certs/ca.key.old

# generate a new CA (ECDSA P-256 example; match your existing algorithm)
openssl ecparam -name prime256v1 -genkey -noout -out deploy/certs/ca.new.key
openssl req -new -x509 -key deploy/certs/ca.new.key \
  -out deploy/certs/ca.new.crt -days 3650 \
  -subj "/CN=power-manage-root-$(date +%Y)"
```

Keep both `.old` and `.new` material on disk for the duration of the window.

### Phase 2 — Trust both roots

Build a combined PEM containing the old root followed by the new root, and point `CONTROL_CA_TRUST_BUNDLE_PATH` at it:

```bash
cat deploy/certs/ca.crt.old deploy/certs/ca.new.crt > deploy/certs/ca-bundle.pem
```

In `.env`:

```env
CONTROL_CA_TRUST_BUNDLE_PATH=/certs/ca-bundle.pem
```

Restart control + gateway:

```bash
docker compose restart control gateway
```

Both processes now accept agent certs chaining to *either* root. The signing key (`CONTROL_CA_KEY`) is still the *old* one — newly-issued certs still chain to `ca.crt.old`.

### Phase 3 — Cut over the signer

When you're ready to issue new certs under the new root, swap the signer:

```bash
cp deploy/certs/ca.new.crt deploy/certs/ca.crt
cp deploy/certs/ca.new.key deploy/certs/ca.key
docker compose restart control gateway
```

From this point: every `RenewCertificate` and every fresh enrolment produces a cert signed by the new root. Existing agent certs (signed by the *old* root) are still trusted by the gateway because the bundle still contains the old root.

### Phase 4 — Wait, then drop the old root

Agents renew automatically at 80 % of their cert lifetime — so for a 1-year cert lifetime, allow ~10 months for the fleet to fully migrate. Watch the audit log for `CertificateRenewed` events to confirm coverage. You can also check the `devices_projection` row's cert fingerprint to spot stragglers.

When you're confident every active agent has renewed under the new root, drop the old root from the bundle:

```bash
cp deploy/certs/ca.new.crt deploy/certs/ca-bundle.pem
docker compose restart control gateway
```

Stragglers that haven't renewed by this point will fail their next mTLS handshake. That's the intended cutoff — they re-enrol with a fresh registration token.

## What rotation gets you (and doesn't)

Rotating the root **invalidates** every cert chained to the old root, at the moment the old root drops out of the trust bundle. That's the lever you have for revocation today: per-fingerprint revocation isn't implemented, so "cut the device off" means "drop the old root early" — at the cost of forcing the rest of the fleet to re-enrol if they haven't migrated yet.

It does **not** rotate:

- `CONTROL_ENCRYPTION_KEY` (AES-GCM key for secrets at rest). Separate procedure — see the FAQ entry.
- `PM_TASK_SIGNING_KEY` (HMAC for Asynq envelopes). See [Asynq task signing](/security/task-signing).
- The HTTPS cert on Traefik.

## Backout

If something goes wrong between Phase 2 and Phase 4, the old key + cert are still on disk as `.old`. Restoring them is a `cp` and a `docker compose restart`. After Phase 4 (old root dropped) there is no rollback — agents whose certs no longer chain to a trusted root have to re-enrol.

## Known limitations

- **No live reload.** Every phase needs a `docker compose restart control gateway`. The reload is fast (seconds), but it does drop in-flight RPCs.
- **No per-device migration check.** Watch the `CertificateRenewed` event stream; there is no "show me all devices still on the old root" RPC yet.
- **No admin force-renew.** You can't push a renewal to a specific device. The agent's 80%-lifetime tick is the only driver.

If any of those limitations would bite you, file an issue against `manchtools/power-manage-server`.
