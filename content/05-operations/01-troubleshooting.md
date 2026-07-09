---
title: Troubleshooting
---
# Troubleshooting

A long page on purpose. Search ("Search docs…" in the top nav, or ⌘K) for the symptom you're seeing. Each section names the symptom, then explains what's actually happening, then lists the fix. For a proactive whole-stack pass, run [`control doctor`](/operations/control-doctor) first — it encodes several of these traps as checks.

## Agent issues

### Enrolment fails with "invalid registration token"

<!-- docref: begin src=server:internal/api/token_handler.go#TokenHandler.CreateToken:9e712a3f,server:internal/api/registration_handler.go#RegistrationHandler.Register:194b15b9 -->
The registration handler rejects with one of four distinct messages — read which one you got:

1. **`invalid registration token`** — the token doesn't exist (typo, or copied from another environment).
2. **`registration token is disabled`** — someone toggled it off in **Devices** → **Enrolment tokens** (`SetTokenDisabled`).
3. **`registration token has expired`** — self-service (`CreateToken:self`) tokens are always minted with a **7-day** expiry; operator-created tokens carry whatever `expires_at` the operator set. Expired tokens stay visible in the list for audit but don't enrol.
4. **`registration token has reached max uses`** — self-service tokens are always **single-use**; operator-created tokens honour their `one_time` / `max_uses` settings.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/deviceauth/enroll.go#EnrollHandler.Enroll:20f2e054 -->
If you've been retrying a broken setup, note enrolment is rate-limited to **5 attempts per minute** (on the agent's local socket, and again per-IP at the control server). Wait a minute.
<!-- docref: end -->

`docker compose logs control --since=5m | grep -i 'registration token'` shows the rejections server-side; `ListTokens` (web UI: **Devices** → **Enrolment tokens**) shows consumed/expiry state.

### Agent says "connect: connection refused" to the gateway

The agent enrolled but can't reach the gateway. Two layers to check.

```bash
# From the agent host — expect the TLS handshake to REACH the gateway
# and then fail asking for a client certificate:
openssl s_client -connect gateway.example.com:443 -servername gateway.example.com </dev/null 2>&1 | head -20
```

<!-- docref: begin src=server:internal/handler/agent.go#MTLSMiddleware:c507fa5e -->
The gateway *requires* a client certificate at the TLS layer, so a plain probe that gets as far as a certificate request (or a handshake failure complaining about a missing client cert) actually proves routing works. Interpreting the failure:

| Symptom | Likely cause |
|---|---|
| Connection refused outright | Gateway container not running or Traefik not routing the gateway hostname (SNI passthrough) |
| Handshake fails before any cert exchange | `GATEWAY_DOMAIN` in `.env` doesn't match the actual public DNS name |
| Connection succeeds but mTLS fails | Agent cert signed by a CA the gateway doesn't trust (gateway redeployed without the same CA file), or — check the gateway log — the cert has been **revoked** (device was deleted or the cert superseded), or the gateway's revocation list hasn't loaded (fail-closed) |

For the mTLS cases the gateway's logs are explicit: `tls: client certificate signed by unknown authority`, `client certificate revoked`, or `client certificate revocation unavailable`. For an untrusted CA, re-mount the CA file; for a revoked cert, re-enrol the agent (fresh registration token, then re-run enrolment) — a deleted device's cert is revoked on purpose.
<!-- docref: end -->

### Agent shows "offline" in the UI but the process is running

<!-- docref: begin src=agent:cmd/power-manage-agent/backend.go#randomBackoff:8ef0d674 -->
The agent process can be up and still not registered as online. The "online" signal is a heartbeat over the bidi gateway stream; if the stream broke, the agent retries indefinitely with exponential backoff (randomised start, doubling, capped at **5 minutes**) — so after a long outage it can take up to 5 minutes to come back even though the network is fine.
<!-- docref: end -->

```bash
# On the agent host:
sudo journalctl -u power-manage-agent --since=5m | grep -E 'stream|connect|backoff'
```

Look for `stream closed` or dial errors. Then check the gateway side:

```bash
# On the deploy host:
docker compose logs gateway --since=5m | grep <device-id>
```

If the gateway has no record of the device trying to connect, it's a network issue between the agent and Traefik. If it does have a record and rejected the connection, the message will say why (revoked cert, peer-class mismatch, etc.).

### Action says "completed" but the change didn't happen on the device

Two things look like this:

<!-- docref: begin src=server:internal/eventtypes/types.go#ExecutionCompleted:07405676,server:internal/eventtypes/types.go#ExecutionFailed:07405676 -->
1. **The action was idempotent and the device was already converged.** `ExecutionCompleted` events with `changed=false` are the normal "no-op" result. Check the execution detail in the web UI; if it says `changed: false`, the device was already in the desired state.
2. **The action's detection script lied.** Custom `SHELL` actions with a `detection_script` report compliant when the script returns 0. If the script returns 0 incorrectly, the agent skips the remediation.
<!-- docref: end -->

If you're sure the device should have changed, force a SYNC and check `journalctl -u power-manage-agent --since=10m -n 100` for the actual command output.

### `ACTION_TYPE_PACKAGE` fails with "could not get lock"

<!-- docref: begin src=sdk:pkg/repair.go#removeStaleLock:2acb4c8a -->
The agent self-heals package-manager locks before package operations — but only **stale** ones. A lock file is removed only when a probe proves no live process holds it (`fuser` for flock-style locks; a PID-liveness check for zypper's PID file). Any inconclusive probe leaves the lock in place — the agent must never steal a live lock. So if you still see the error, a real process holds it:

- **Long-running apt/dnf process.** unattended-upgrades, snap refresh, cloud-init. The operation fails with the manager's own lock error; check `ps auxf | grep -E 'apt|dnf|packagekit'` on the device and let it finish (or kill it), then re-dispatch.
- **A wedged process that still holds the lock.** The agent can't safely remove it. `sudo kill <pid>`, then re-dispatch.
<!-- docref: end -->

## Authentication and sign-in

### "Invalid credentials" but the password is right

Three layers:

1. **TOTP enabled but not entered.** If the account has TOTP, the password is only step 1 — the server returns a short-lived challenge and the sign-in form should show the code prompt. See [Two-factor authentication](/security/two-factor). If the prompt never appears, the JS is broken (browser console will tell you); try an incognito window in case it's a cached bundle.
<!-- docref: begin src=server:cmd/control/admin_user.go#ensureAdminUser:f0dbf778 -->
2. **Bootstrap admin password forgotten.** The bootstrap admin comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` and is created **only if no user with that email exists** — changing the password in `.env` later does nothing (the existing user row wins; changing the *email* would create a second admin instead). Another admin can reset it: web UI **Users** → user-detail → **Reset password** (the `UpdateUserPassword` RPC). If you don't have another admin, recover from a Postgres backup or fix the row via `psql`.
<!-- docref: end -->
<!-- docref: begin src=server:cmd/control/flags.go#validateAdminPassword:74044caa -->
3. **`CONTROL_PASSWORD_AUTH_ENABLED` is `false`.** If you disabled password auth for SSO-only mode and your SSO provider isn't working, password fall-back is also blocked. Flip the env var back to `true`, restart the control container, sign in, then fix SSO. (The bootstrap password itself is validated at boot — minimum length enforced — so a truncated `.env` value also refuses startup with a clear error.)
<!-- docref: end -->

### OIDC sign-in redirects to a CORS error

The redirect URL configured on your IdP must point at the **web UI host**, not your control server. power-manage's web UI handles the OIDC callback and forwards the code to your control server.

Set the IdP's `redirect_uri` to `https://app.power-manage.manchtools.com/auth/callback/<provider-slug>`. The slug is what you typed when you added the provider in the web UI.

### SCIM provisioning request returns 401

The SCIM bearer token is bcrypt-hashed at rest. If you copied it from the web UI when you created the provider, that was the only time it's visible. Once you save, it can't be retrieved.

To fix, call `RotateSCIMToken` (in the UI: **Identity providers** → **SCIM** tab → **Rotate token** on the provider). A new token displays once. Copy it, then update the IdP's SCIM config with the new value.

<!-- docref: begin src=server:internal/scim/handler.go#NewHandler:5531cee7 -->
If the rotation also doesn't work, check for rate limiting: the SCIM endpoint allows **100 requests/minute per provider slug** and **20 requests/minute per slug + client IP**. A 429 means back off for a minute; a sustained 429 at low volume means something else (a retry loop on the IdP side) is burning the budget.
<!-- docref: end -->

### "Refresh token expired" right after signing in

<!-- docref: begin src=server:internal/auth/jwt.go#NewJWTManager:3a949d21,server:cmd/control/flags.go#validateJWTSecretStrength:455b6cee -->
Access tokens are 5 minutes, refresh tokens are 7 days. If the refresh token is dying immediately, something is invalidating it. Common causes:

- **Clock skew.** If the device's clock is more than a couple minutes off from the control server's, the JWT verification fails on `nbf` / `exp`. `chronyc tracking` or `timedatectl status` to check.
- **`JWT_SECRET` rotated.** Changing `JWT_SECRET` in `.env` invalidates every issued token. Everyone needs to sign in again. (The secret must decode to at least 32 random bytes — the control server refuses to boot with a weaker one, so a "shorten it to fix boot" experiment also logs everyone out.)
- **User session_version bumped.** Disabling a user, changing their role, or removing them from a group bumps their session version on the user projection. Every token issued under the old version becomes invalid. Sign in again to mint a new one.
<!-- docref: end -->

## Action dispatch and execution

### Actions sit "Pending" forever and never reach the agent

Three places the dispatch can be stuck:

1. **Asynq queue blocked.** `docker compose exec valkey valkey-cli LLEN 'asynq:{device:<device-id>}:pending'` shows the queue depth (Asynq nests the queue name in braces). If it's growing, the gateway worker is wedged. `docker compose restart gateway` is the brute-force fix.
2. **Maintenance window blocking it.** The action will show as queued for the window on the device-detail page. The window opens in device-local time; check the device's timezone with `sudo timedatectl status`.
3. **Signature verification failing.** The agent rejects unsigned or tampered dispatches. `sudo journalctl -u power-manage-agent | grep -i 'unsigned/tampered'` shows the refusals ([mTLS and signed actions](/security/mtls)).

### Asynq dead queue is filling up

Dead-lettered (archived) entries mean the consumer permanently failed a task (max retries exhausted, or `asynq.SkipRetry` was returned — which is what an HMAC signature failure does). Inspect with:

```bash
docker compose exec valkey valkey-cli SCAN 0 MATCH 'asynq:*:archived' COUNT 100
```

Most commonly the failure is a `PM_TASK_SIGNING_KEY` mismatch between services ([Asynq task signing](/security/task-signing)), an agent that's gone offline, or a malformed payload from a now-fixed bug. `control doctor` has a dedicated `queues` check for this. Don't blindly re-enqueue; diagnose the cause first.

### Compliance policies report "evaluating" indefinitely

<!-- docref: begin src=agent:cmd/power-manage-agent/main.go#defaultSyncInterval:2d5b57db -->
Compliance evaluation happens during the agent's reconciliation tick (default sync interval: **30 minutes**). If a device shows `evaluating` for more than a few ticks, the agent is either offline (see the agent-offline section above) or stuck on an action upstream in the same set.
<!-- docref: end -->

Check the device's execution log for the action that immediately precedes the compliance evaluation; if it's also stuck, fix that first. Compliance is downstream of the actions it depends on.

## Deployment

### Containers won't start: "permission denied" on the data volume

Postgres and Valkey write to bind-mounted volumes under `deploy/data/`. `setup.sh` creates the directories world-traversable (`chmod 755`) so the container users — **postgres runs as uid 70** (alpine image), **valkey as uid 999** — can initialise them. If you skipped the script or moved the volumes, recreate that state:

```bash
mkdir -p deploy/data/postgres deploy/data/valkey deploy/data/traefik
chmod 755 deploy/data/postgres deploy/data/valkey deploy/data/traefik
```

If you previously `chown`ed the trees to another user, `sudo chown -R 70 deploy/data/postgres` and `sudo chown -R 999 deploy/data/valkey` match the container UIDs.

### Traefik fails to acquire Let's Encrypt certs

Port 443 must be reachable from the public internet. The standard checks:

```bash
# From outside the host:
curl -v https://control.example.com 2>&1 | head -20
```

If the connection times out, your firewall, cloud security group, or upstream NAT is blocking it. Let's Encrypt also needs port 80 reachable for the HTTP-01 challenge unless you've configured DNS-01.

For DNS-related failures (`acme: error presenting token...`), check Traefik's logs:

```bash
docker compose logs traefik --since=5m | grep -i acme
```

### Control container exits with "CONTROL_ENCRYPTION_KEY is required"

<!-- docref: begin src=server:cmd/control/setup.go#initEncryptor:a09df529,server:cmd/control/setup.go#errEncryptionKeyRequired:4f139f80 -->
Encryption at rest is **mandatory, with no opt-out**: the control server refuses to boot without a valid `CONTROL_ENCRYPTION_KEY` (32-byte key, e.g. from `openssl rand -hex 32`), and the compose file refuses to even start the container with the variable unset. The former `CONTROL_ENCRYPTION_KEY_REQUIRED=false` escape hatch was removed on purpose — a misconfigured deployment fails loudly instead of silently storing IdP secrets, LUKS keys, and LPS passwords in plaintext. Generate a key, put it in `.env`, keep it in your backups.
<!-- docref: end -->

### Indexer logs "no Postgres connection" but Postgres is up

The indexer reads its database password from `INDEXER_POSTGRES_PASSWORD`, which is a separate variable from `POSTGRES_PASSWORD`. Both default to empty strings if you skipped `setup.sh`, and an empty password is rejected by Postgres.

Make sure both are set:

```bash
grep -E '^(INDEXER_)?POSTGRES_PASSWORD=' .env
```

If `INDEXER_POSTGRES_PASSWORD=` (empty), regenerate via `./setup.sh` or set it manually to a fresh value, then restart the indexer container.

## Search

### Search returns stale data

> The compose stack runs `valkey/valkey-bundle` — Valkey with the valkey-search module — since the 2026.07 cutover replaced the old `redis/redis-stack-server` dependency. The `FT.*` diagnostic commands work the same.

<!-- docref: begin src=server:internal/search/index.go#idxDevices:c43b4701,server:internal/api/search_handler.go#SearchHandler.RebuildSearchIndex:c9621293 -->
The indexer reconciles against Postgres on a schedule. If a recent change isn't appearing in search:

```bash
docker compose exec valkey valkey-cli FT._LIST
docker compose exec valkey valkey-cli FT.INFO idx:devices
```

The indexes are named `idx:<entity>` (`idx:devices`, `idx:users`, `idx:actions`, …). The `RebuildSearchIndex` RPC on the control server triggers a forced rebuild; the web UI exposes it under **Settings** → **Search** for any user with the `RebuildSearchIndex` permission. `control doctor`'s `search` check verifies the expected indexes exist.
<!-- docref: end -->

## Diagnostic commands cheat-sheet

```bash
# One-shot health + posture pass (see the control doctor page)
docker compose exec control control doctor

# Stack health
docker compose ps
docker compose logs control gateway indexer --since=5m --tail=200

# Control server version (logged on boot)
docker compose logs control --since=10m | grep '"starting control server"'

# Postgres
docker compose exec postgres psql -U powermanage -d powermanage -c '\dt'
docker compose exec postgres psql -U powermanage -d powermanage \
    -c "select stream_type, count(*) from events group by 1 order by 2 desc limit 10"

# Valkey / Asynq queue depth
docker compose exec valkey valkey-cli INFO keyspace
docker compose exec valkey valkey-cli KEYS 'asynq:*' | head

# Agent
sudo systemctl status power-manage-agent
sudo journalctl -u power-manage-agent --since=10m -n 200
```

If none of the above gets you unstuck, the [FAQ](/operations/faq) covers a few common "is this supposed to work like this?" questions. Beyond that, file an issue at [`manchtools/power-manage-server`](https://github.com/manchtools/power-manage-server/issues) with the symptom, the logs, and the server version (from the startup log line above).
