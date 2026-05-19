# Troubleshooting

A long page on purpose. Search ("Search docs…" in the top nav, or ⌘K) for the symptom you're seeing. Each section names the symptom, then explains what's actually happening, then lists the fix.

## Agent issues

### `pm-enroll` says "registration token rejected"

Three things to check, in order:

1. **Token has been used already.** Enrolment tokens are single-use. The web UI's **Devices** → **Enrolment tokens** page (backed by `ListTokens`) shows the consumed status; `CreateToken` generates a new one.
2. **Token expired.** Default lifetime is 24 hours. The token list shows expiry; expired tokens stay visible for audit but don't enrol.
3. **Rate-limited.** The control server caps enrolment at 5 attempts per minute per IP. If you've been retrying a broken setup, wait a minute.

The control server's audit log records every enrolment attempt with the actor (the IP) and the outcome. `docker compose logs control --since=5m | grep enrolment` gives you the raw events.

### Agent says "connect: connection refused" to the gateway

The agent enrolled but can't reach the gateway. Two layers to check.

```bash
# From the agent host:
curl -sv https://gateway.example.com/health 2>&1 | head -20
```

A clean TLS handshake plus a redirect to the SNI passthrough is what you want. Common failures:

| Symptom | Likely cause |
|---|---|
| Connection refused outright | Gateway container not running or Traefik not routing the gateway hostname |
| TLS handshake fails | `GATEWAY_DOMAIN` in `.env` doesn't match the actual public DNS name |
| Connection succeeds but mTLS fails | Agent cert was signed by a CA the gateway doesn't trust (usually means the gateway has been redeployed without the same CA bundle) |

For the mTLS case, the gateway's logs show `tls: client certificate signed by unknown authority`. Re-mount the CA bundle volume or unenrol + re-enrol the agent (single-use registration token, then `pm-enroll` again) so its cert is signed by the current CA.

### Agent shows "offline" in the UI but the process is running

The agent process can be up and still not registered as online. The "online" signal is a heartbeat over the bidi gateway stream; if the stream broke, the agent retries indefinitely with exponential backoff (capped at 60s).

```bash
# On the agent host:
sudo journalctl -u power-manage-agent --since=5m | grep -E 'stream|connect'
```

Look for `stream closed: connection reset` or `dial timeout`. Then check the gateway side:

```bash
# On the deploy host:
docker compose logs gateway --since=5m | grep <device-id>
```

If the gateway has no record of the device trying to connect, it's a network issue between the agent and Traefik. If it does have a record and rejected the connection, the message will say why (cert revoked, SPIFFE SAN mismatch, etc.).

### Action says "completed" but the change didn't happen on the device

Two things look like this:

1. **The action was idempotent and the device was already converged.** `ExecutionCompleted` events with `changed=false` are the normal "no-op" result. Check the execution detail in the web UI; if it says `changed: false`, the device was already in the desired state.
2. **The action's detection script lied.** Custom `SHELL` actions with a `detection_script` will report `compliant` when the script returns 0. If the script returns 0 incorrectly, the agent skips the remediation.

If you're sure the device should have changed, force a SYNC and check `journalctl -u power-manage-agent --since=10m -n 100` for the actual command output.

### `ACTION_TYPE_PACKAGE` fails with "could not get lock"

The agent self-heals package manager locks before every package operation. If you're still seeing the error, two cases:

- **Long-running apt process.** Something else on the system (unattended-upgrades, snap refresh, cloud-init) is holding the lock. The agent waits up to 30 seconds; longer than that and it gives up. Check `ps auxf | grep apt` on the device.
- **Stale lock file from a kernel oops.** The agent only clears lock files that aren't held by an active process. If a process actually has the lock but is wedged, the agent can't safely steal it. `sudo kill <pid>` then re-dispatch.

## Authentication and sign-in

### "Invalid credentials" but the password is right

Three layers:

1. **TOTP enabled but not entered.** If the account has TOTP, the password is only step 1. The sign-in form should show the TOTP prompt after the password; if it doesn't, the JS is broken (browser console will tell you). Try an incognito window in case it's a cached bundle.
2. **Bootstrap admin password forgotten.** The bootstrap admin's credentials come from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` and are written to the database on first boot only. Changing them in `.env` later does nothing — the user record already exists with the original (hashed) password. Another admin can reset it: web UI **Users** → user-detail → **Reset password**, which calls the `UpdateUserPassword` RPC. If you don't have another admin, recover the password from a Postgres backup or rebuild the bootstrap admin row directly via `psql`.
3. **CONTROL_PASSWORD_AUTH_ENABLED is false.** If you disabled password auth for SSO-only mode and your SSO provider isn't working, password fall-back is also blocked. Flip the env var back to `true`, restart the control container, sign in, then fix SSO.

### OIDC sign-in redirects to a CORS error

The redirect URL configured on your IdP must point at the **web UI host**, not your control server. Power Manage's web UI handles the OIDC callback and forwards the code to your control server.

Set the IdP's `redirect_uri` to `https://app.power-manage.manchtools.com/auth/callback/<provider-slug>`. The slug is what you typed when you added the provider in the web UI.

### SCIM provisioning request returns 401

The SCIM bearer token is bcrypt-hashed at rest. If you copied it from the web UI when you created the provider, that was the only time it's visible. Once you save, it can't be retrieved.

To fix, call `RotateSCIMToken` — in the UI: **Identity providers** → **SCIM** tab → **Rotate token** on the provider. A new token displays once. Copy it, then update the IdP's SCIM config with the new value.

If the rotation also doesn't work, the IdP is rate-limited at the SCIM endpoint (10 requests/minute per slug). Wait a minute and retry.

### "Refresh token expired" right after signing in

Access tokens are 5 minutes, refresh tokens are 7 days. If the refresh token is dying immediately, something is invalidating it. Common causes:

- **Clock skew.** If the device's clock is more than a couple minutes off from the control server's, the JWT verification fails on `nbf` / `exp`. `chronyc tracking` or `timedatectl status` to check.
- **`JWT_SECRET` rotated.** Changing `JWT_SECRET` in `.env` invalidates every issued token. Everyone needs to sign in again.
- **User session_version bumped.** Disabling a user, changing their role, or removing them from a group bumps their session version on the user-projection. Every token issued under the old version becomes invalid. Sign in again to mint a new one.

## Action dispatch and execution

### Actions sit "Pending" forever and never reach the agent

Three places the dispatch can be stuck:

1. **Asynq queue blocked.** `docker compose exec valkey valkey-cli LLEN device:<device-id>` shows the queue depth. If it's growing, the gateway worker is wedged. `docker compose restart gateway` is the brute-force fix.
2. **Maintenance window blocking it.** The action will say `Queued (window closed)` on the device-detail page. The window opens in device-local time; check the device's timezone with `sudo timedatectl status`.
3. **Signature verification failing.** The agent rejects unsigned or tampered dispatches. `sudo journalctl -u power-manage-agent | grep signature` shows the rejection.

### Asynq dead queue is filling up

Dead queue entries mean the consumer permanently failed a task (max retries exhausted, or `asynq.SkipRetry` was returned). Inspect with:

```bash
docker compose exec valkey valkey-cli SCAN 0 MATCH 'asynq:dead*' COUNT 100
```

Most commonly the failure is an action-signing key mismatch, an agent that's gone offline, or a malformed action payload from a now-fixed bug. Don't blindly re-enqueue; diagnose the cause first.

### Compliance policies report "evaluating" indefinitely

Compliance evaluation happens during the agent's reconciliation tick. If a device shows `evaluating` for more than a few ticks (15+ minutes by default), the agent is either offline (see the agent-offline section above) or stuck on an action upstream in the same set.

Check the device's execution log for the action that immediately precedes the compliance evaluation; if it's also stuck, fix that first. Compliance is downstream of the actions it depends on.

## Deployment

### Containers won't start: "permission denied" on the data volume

Postgres and Valkey write to bind-mounted volumes. The container user ID needs write access to the host paths. The `setup.sh` script handles this; if you skipped it or moved the volumes, set the ownership manually:

```bash
sudo chown -R 999:999 ./deploy/data/postgres
sudo chown -R 999:999 ./deploy/data/valkey
```

(999 is the default UID for both `postgres` and `redis` in the upstream images.)

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

### Control container exits with "encryption key required"

`CONTROL_ENCRYPTION_KEY_REQUIRED=true` (the default) means the control server refuses to boot without a valid 64-hex-char `CONTROL_ENCRYPTION_KEY`. The default is intentional — encrypted secrets at rest is on by default, fail-closed.

For dev environments where you genuinely don't want at-rest encryption, set `CONTROL_ENCRYPTION_KEY_REQUIRED=false` in `.env`. Do not do this in prod.

### Indexer logs "no Postgres connection" but Postgres is up

The indexer reads its database password from `INDEXER_POSTGRES_PASSWORD`, which is a separate variable from `POSTGRES_PASSWORD`. Both default to empty strings if you skipped `setup.sh`, and an empty password is rejected by Postgres.

Make sure both are set:

```bash
grep -E '^(INDEXER_)?POSTGRES_PASSWORD=' .env
```

If `INDEXER_POSTGRES_PASSWORD=` (empty), regenerate via `./setup.sh` or set it manually to a fresh 64-hex value, then restart the indexer container.

## Search

### Search returns no results for known terms

Two failure modes:

1. **Pagefind index isn't built.** Pagefind runs at docs build time, not at runtime. If you deployed the docs without running `bun run build`, there's no index. Re-build.
2. **Search query is shorter than the minimum.** Pagefind's minimum query length is 2 characters by default. One-letter queries return nothing.

### RediSearch returns stale data

The indexer reconciles against Postgres on a schedule. If a recent change isn't appearing in search:

```bash
docker compose exec valkey valkey-cli FT._LIST
docker compose exec valkey valkey-cli FT.INFO devices_idx
```

`last_indexing_finished_time` on the index shows when it was last rebuilt. The `RebuildSearchIndex` RPC on the control server triggers a forced rebuild — the web UI exposes it under **Settings** → **Search** for any user with the `RebuildSearchIndex` permission.

## Diagnostic commands cheat-sheet

```bash
# Stack health
docker compose ps
docker compose logs control gateway indexer --since=5m --tail=200

# Control / gateway / indexer version (logged on boot)
docker compose logs control --since=10m | grep '"starting control server"'

# Postgres
docker compose exec postgres psql -U powermanage -d powermanage -c '\dt'
docker compose exec postgres psql -U powermanage -d powermanage \
    -c "select stream_type, count(*) from events group by 1 order by 2 desc limit 10"

# Valkey / Asynq queue depth
docker compose exec valkey valkey-cli INFO keyspace
docker compose exec valkey valkey-cli KEYS 'asynq:queues:*' | head

# Agent
sudo systemctl status power-manage-agent
sudo journalctl -u power-manage-agent --since=10m -n 200
```

If none of the above gets you unstuck, the [FAQ](/operations/faq) covers a few common "is this supposed to work like this?" questions. Beyond that, file an issue at [`manchtools/power-manage-server`](https://github.com/manchtools/power-manage-server/issues) with the symptom, the logs, and the server version (from the startup log line above).
