---
title: CA rotation
---
# Root CA rotation

<!-- docref: begin src=server:deploy/setup.sh:f721854f -->
Power-manage has one CA root today: the value of `CONTROL_CA_CERT` / `CONTROL_CA_KEY` (`deploy/certs/ca.crt` / `ca.key`, minted by `setup.sh` with a 10-year lifetime). It signs:

- Every agent's client certificate (used for mTLS into the gateway).
- The gateway's own server cert (`deploy/certs/gateway.crt`).
- The control server's `InternalService` cert (`deploy/certs/control.crt`).
<!-- docref: end -->

> **The HTTPS cert on Traefik is independent.** That's whatever issuer you use for `control.<your-domain>` (Let's Encrypt, an internal PKI, etc.) — it does *not* chain to `CONTROL_CA_CERT`. Rotating Traefik's cert is your existing TLS-cert workflow; it has nothing to do with this page.

There is no `RotateRootCA` CLI command or RPC. Rotation is a deploy-time procedure built around two primitives:

<!-- docref: begin src=server:cmd/control/flags.go#applyEnvOverrides:41b51197,server:internal/ca/ca.go#CA.SetTrustBundle:89b525aa -->
- **The control server's trust bundle.** `CONTROL_CA_TRUST_BUNDLE` points at a PEM with multiple CA certs; during the rotation window both the *old* root and the *new* root verify agent certs. Signing stays on `CONTROL_CA_CERT` / `CONTROL_CA_KEY`.
<!-- docref: end -->
<!-- docref: begin src=server:internal/mtls/mtls.go#NewTLSConfig:4e33a1ed -->
- **The gateway's client-CA pool.** The gateway loads its client-verification pool from the `-tls-ca` file (compose mounts `deploy/certs/ca.crt`). That file may contain multiple CA certs, so putting both roots in it makes the gateway accept agent certs chaining to either.
<!-- docref: end -->

<!-- docref: begin src=sdk:crypto/cert.go#VerifyCAContinuity:30b656cc,agent:cmd/power-manage-agent/cert_rotation.go#applyRenewal:49ccae95 -->
And one hard constraint: **agents only adopt a new CA over the renewal channel if it chains to the CA they enrolled with.** The renewal response's CA cert must be byte-identical to the enrolled CA *or cross-signed by it*; an unrelated self-signed root is refused as a trust-anchor swap and the agent keeps its old cert + CA. So the new root MUST be cross-signed with the old key — mint an independent root and the fleet will refuse it, stalling every renewal until re-enrolment.
<!-- docref: end -->

## When to rotate

- The CA key is suspected to have leaked (host compromise, accidental backup, departing operator with disk access).
- Compliance-driven rotation (annual or triennial, depending on your regime).
- The CA's algorithm or key size no longer meets your standard (e.g. moving from a 2048-bit RSA root to a P-256 ECDSA root).
- The CA cert is approaching expiry. `setup.sh` mints it with `-days 3650`; check `openssl x509 -in deploy/certs/ca.crt -noout -dates`.

Routine rotation "just because" isn't recommended — it's a non-trivial procedure and every issued agent cert has to renew under the new root before the old one drops.

{% callout type="warn" title="Cutting one device off is not a rotation job any more" %}
Per-fingerprint revocation exists: deleting a device adds its cert to the Valkey-backed CRL and the gateway rejects it at the next connection. Rotate the root to retire the *key*, not to revoke one machine — see [mTLS and signed actions](/security/mtls).
{% /callout %}

## The procedure

The flow has four phases. Don't compress them — the overlap window is what gives you a rollback path.

### Phase 1 — Mint the new CA, cross-signed by the old one

On the deploy host (paths relative to `deploy/`):

```bash
# back up the existing root
cp certs/ca.crt certs/ca.crt.old
cp certs/ca.key certs/ca.key.old

# new key (P-256 example; match your policy)
openssl ecparam -name prime256v1 -genkey -noout -out certs/ca.new.key

# CSR for the new CA...
openssl req -new -key certs/ca.new.key \
  -subj "/CN=Power Manage Internal CA $(date +%Y)/O=Power Manage" \
  -out certs/ca.new.csr

# ...cross-signed by the OLD root, as a CA cert.
cat > certs/ca-ext.cnf <<'EOF'
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
EOF
openssl x509 -req -in certs/ca.new.csr \
  -CA certs/ca.crt.old -CAkey certs/ca.key.old -CAcreateserial \
  -days 3650 -extfile certs/ca-ext.cnf \
  -out certs/ca.new.crt
```

The cross-signature is what lets already-enrolled agents accept the new CA at their next renewal. Keep both `.old` and `.new` material on disk for the duration of the window.

### Phase 2 — Trust both roots

Build a combined PEM with the **old root first** (the control server signs with the first block of `CONTROL_CA_CERT`, so order matters while the old key is still the signer):

```bash
cat certs/ca.crt.old certs/ca.new.crt > certs/ca-bundle.pem
```

Point the control server's verification pool at it (add to the control service environment if it isn't there yet):

```env
CONTROL_CA_TRUST_BUNDLE=/certs/ca-bundle.pem
```

Make the gateway's client-CA file the same bundle — the gateway's `-tls-ca` flag points at `/certs/ca.crt`, so replace that file's contents:

```bash
cp certs/ca-bundle.pem certs/ca.crt
```

Restart control + gateway:

```bash
docker compose restart control gateway
```

Both processes now accept agent certs chaining to *either* root. The signing key (`CONTROL_CA_KEY`) is still the *old* one — newly-issued certs still chain to `ca.crt.old`.

### Phase 3 — Cut over the signer

When you're ready to issue under the new root, swap the signer (new cert first in `ca.crt`, old kept for verification) and re-issue the internal gateway/control certs under the new CA:

```bash
cat certs/ca.new.crt certs/ca.crt.old > certs/ca.crt
cp certs/ca.new.key certs/ca.key

# re-issue gateway.crt / control.crt from the new CA (same commands
# setup.sh used, signed with ca.new.key), and append ca.new.crt to
# gateway.crt so not-yet-renewed agents can chain through the
# cross-signed intermediate to their old root.

docker compose restart control gateway
```

<!-- docref: begin src=agent:cmd/power-manage-agent/cert_rotation.go#renewAt:211ccaeb,server:internal/eventtypes/types.go#DeviceCertRenewed:f3b5b093 -->
From this point: every `RenewCertificate` and every fresh enrolment produces a cert signed by the new root, and the renewal response carries the new CA cert, which agents adopt (it chains to their enrolled root via the cross-signature). Existing agent certs signed by the *old* root stay trusted because the bundle still contains it. Watch the audit log for `DeviceCertRenewed` events to track migration — agents renew at 80% of their cert lifetime.
<!-- docref: end -->

### Phase 4 — Wait, then drop the old root

Agents renew automatically at 80% of their cert lifetime — so for a 1-year cert lifetime, allow ~10 months for the fleet to fully migrate. You can also check the `devices_projection` row's cert fingerprint/expiry to spot stragglers.

When you're confident every active agent has renewed under the new root, drop the old root everywhere:

```bash
cp certs/ca.new.crt certs/ca.crt
cp certs/ca.new.crt certs/ca-bundle.pem
docker compose restart control gateway
```

Stragglers that haven't renewed by this point will fail their next mTLS handshake. That's the intended cutoff — they re-enrol with a fresh registration token.

## What rotation gets you (and doesn't)

Rotating the root **invalidates** every cert chained to the old root, at the moment the old root drops out of the trust material. For single-device cutoff, use device deletion (CRL) instead — it's immediate and doesn't touch the rest of the fleet.

It does **not** rotate:

- `CONTROL_ENCRYPTION_KEY` (AES-GCM key for secrets at rest). Separate procedure — see the FAQ entry.
- `PM_TASK_SIGNING_KEY` (HMAC for Asynq envelopes). See [Asynq task signing](/security/task-signing).
- The HTTPS cert on Traefik.

<!-- docref: begin src=server:internal/ca/ca.go#NewFromPEM:2da06d00,server:cmd/control/flags.go#parseFlags:d739daf2 -->
One more constraint on the *new* key's type: the CA key signs both certificates and dispatched actions, so it must be ECDSA or RSA — the control server refuses to boot with anything else (Ed25519 included). Issued agent certs get the validity from the `-cert-validity` flag (default 1 year).
<!-- docref: end -->

## Backout

If something goes wrong between Phase 2 and Phase 4, the old key + cert are still on disk as `.old`. Restoring them is a `cp` and a `docker compose restart`. After Phase 4 (old root dropped) there is no rollback — agents whose certs no longer chain to a trusted root have to re-enrol.

## Known limitations

<!-- docref: begin src=agent:cmd/power-manage-agent/cert_rotation.go#startCertRotation:81135da7 -->
- **No live reload.** Every phase needs a `docker compose restart control gateway`. The reload is fast (seconds), but it does drop in-flight RPCs.
- **No per-device migration check.** Watch `DeviceCertRenewed` events; there is no "show me all devices still on the old root" RPC yet.
- **No admin force-renew.** You can't push a renewal to a specific device. The agent's 80%-lifetime tick (with hourly retry on failure) is the only driver.
- **No hard root swap over the wire.** An uncross-signed replacement root means re-enrolling the fleet, full stop.
<!-- docref: end -->

If any of those limitations would bite you, file an issue against `manchtools/power-manage-server`.
