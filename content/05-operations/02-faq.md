---
title: FAQ
---
# FAQ

Short answers to questions that come up often. For symptom-level "this is broken" investigation, see [Troubleshooting](/operations/troubleshooting).

## "Is there a web UI?"

Yes, but it's a separate hosted service and not bundled with the server stack. The server exposes a Connect-RPC API; the UI at **https://app.power-manage.manchtools.com** points at your control server in your browser. See [The web UI](/get-started/web-ui) for the trust model. Your data never touches the UI host.

The UI is not open-source and isn't shipped for self-hosting. If you need an on-premise client (compliance, custom workflows), build one against the Connect-RPC API. Proto definitions live in [`manchtools/power-manage-sdk`](https://github.com/manchtools/power-manage-sdk).

## "Can I run the agent on Windows or macOS?"

No. Linux only. There is no Windows or macOS build planned. If you need cross-platform endpoint management, this isn't the tool.

The agent depends on Linux-specific subsystems (systemd / OpenRC / runit / s6 for services, LUKS for encryption, package managers, journald, /etc/sudoers, etc.). Porting would be more than a build-target change.

## "How do I rotate the encryption key?"

`CONTROL_ENCRYPTION_KEY` encrypts secrets at rest (IdP client secrets, TOTP secrets, LUKS keys, LPS passwords). There's no built-in rotation tooling yet; every encrypted column has to be decrypted with the old key and re-encrypted with the new one as a manual migration.

The honest path today:

1. Stand up a maintenance window: nothing writing to the database. Stop the `control` container.
2. With both old and new keys available, run a Postgres migration script that walks every `*_encrypted` column, decrypts using `old`, re-encrypts using `new`, writes back.
3. Update `CONTROL_ENCRYPTION_KEY` in `.env` to the new value.
4. Restart the control container.

<!-- docref: begin src=server:docs/adr/0001-aes-key-rotation.md:0dac293b -->
The proper fix — a versioned keyring with the key version in the existing `enc:v<n>:` ciphertext prefix, plus a background re-encrypt sweep — is designed in ADR 0001 (`server/docs/adr/0001-aes-key-rotation.md`) but deliberately deferred; until it ships, write the migration script per-deploy or operate as if the key is permanent.
<!-- docref: end -->

For `PM_TASK_SIGNING_KEY` rotation see [Asynq task signing](/security/task-signing).

## "How do I back up?"

Three things to keep in sync:

| What | How |
|---|---|
| Postgres event store | `pg_dump` of the `powermanage` database. Projections rebuild from events; you don't strictly need them in backup. |
| `.env` | The encryption key in here is what unlocks the event store's secrets. Lose it and the backup is useless. |
| CA material | `deploy/certs/` — `ca.crt` / `ca.key` plus the gateway/control service certs. If you back up the event store but lose the agent CA, every enrolled agent has to re-enrol. |

Daily `pg_dump` + off-host storage of `.env` + the contents of `deploy/certs/` covers all three. The Valkey state (Asynq queues, search indexes) is regenerable from the event store and doesn't need backup.

## "Can I run multiple gateways?"

<!-- docref: begin src=server:internal/config/config.go#Config.TraefikSelfRegister:f47e1041,server:internal/handler/agent.go#BootstrapRedirectMiddleware:ff85a16f -->
Yes, and the plumbing is built in. Each gateway self-registers in Valkey on boot — including publishing its own Traefik routing entries when Traefik runs with the Redis provider (`GATEWAY_TRAEFIK_SELF_REGISTER`, on by default), so `docker compose up --scale gateway=N` works without per-instance route config. Agents first connect to the wildcard bootstrap hostname; whichever gateway receives them replies with an HTTP 307 to its own per-instance hostname, so every subsequent connection lands on the same gateway and the control server knows exactly which gateway holds each device's stream (this mapping is what routes terminal sessions).
<!-- docref: end -->

For high availability, run gateways on separate hosts. An agent whose gateway drops reconnects through the bootstrap hostname and gets adopted by a surviving gateway.

## "Can I run multiple control servers?"

Not today. The control server has several singletons that would race if you ran two replicas against the same Postgres + Valkey:

<!-- docref: begin src=server:cmd/control/periodic.go#startDynamicGroupWorker:0805db00,server:cmd/control/periodic.go#startStaleExecutionExpiry:ef5f969d,server:cmd/control/setup.go#bootstrapAllDevicesGroup:04b9912a -->
- The dynamic-group evaluator and the stale-execution expiry job both run on a process-local timer with no leader election. Two replicas would re-evaluate every group and race the expiry sweep.
- The all-devices-group bootstrap on startup emits a seed event; two replicas racing it rely on the event store's uniqueness to dedupe rather than on any coordination.
<!-- docref: end -->
<!-- docref: begin src=server:internal/store/migrations/002_event_store.sql:7ec3ab3a -->
- Event writes are protected by the store's `(stream_type, stream_id, stream_version)` unique constraint, but that catches conflicting appends *at write time* — it doesn't serialise the concurrent background workers.
<!-- docref: end -->

Practically, a second control replica would *partially* work — RPC reads are fine — but the dynamic-group and expiry workers would fire twice per tick. Newer background workers (audit-log retention, the inventory scheduler) already single-flight across replicas via Postgres advisory locks (`TryWithAdvisoryLock`); the dynamic-group evaluator and expiry sweep haven't been ported to that pattern yet.

If you need control-plane HA today, the supported pattern is **standby**, not **active-active**: a second container ready to start on a different host, sharing the database, brought up only if the primary fails. Add a managed-Postgres failover and you have a reasonable cold-standby story.

Active-active control plus leader election is a future improvement; there's no committed milestone for it.

## "Is there an API?"

Yes. Same Connect-RPC API the web UI uses; it's the public contract. Three flavours of client:

| Client | Generated from | Use case |
|---|---|---|
| Go | `sdk/proto/pm/v1/control.proto` via `buf generate` | CI / scripts on the deploy host |
| TypeScript | Same protos, browser-friendly | Custom UIs, browser automation |
| `curl` | The Connect-RPC wire format is JSON-over-HTTP-POST | Quick one-offs |

A curl example:

```bash
curl -X POST https://control.example.com/pm.v1.ControlService/ListDevices \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{"pageSize": 50}'
```

<!-- docref: begin src=sdk:proto/pm/v1/control.proto#ControlService:e6b2ec4d -->
The full `ControlService` surface (166 RPCs) is documented in the proto files at [`manchtools/power-manage-sdk`](https://github.com/manchtools/power-manage-sdk).
<!-- docref: end -->

## "How do I forward logs / events to my SIEM?"

power-manage does not ship a SIEM integration on the server side, and one isn't planned. The architectural split is:

- **Host-level events** (syslog, journald, file integrity, audit subsystem) are the **agent's** territory. Use the existing host tooling you already deploy via power-manage (`filebeat`, `vector`, `fluent-bit`, `auditbeat`, whatever your SIEM vendor wants) to ship those off-host. The agent is the right place to install and configure these.
- **The audit log on the control server** is the events table in Postgres. The `ListAuditEvents` RPC exposes it for polling-style integrations if you want to write your own bridge, but it's unary (one call returns one page), not a stream. There's no planned server-side SIEM uploader to do this for you.

For the host-tooling path, ship a `SHELL` or `FILE` action that drops the agent vendor's config and a `SERVICE` action that runs the daemon. Same as you'd manage any other system service.

## "How do I decommission a device?"

Two steps:

<!-- docref: begin src=server:internal/api/device_handler.go#DeviceHandler.DeleteDevice:d74b7e3f,server:internal/crl/crl.go#Store.Revoke:17984417 -->
1. **Delete the device record** via the `DeleteDevice` RPC (web UI: device-detail → **Delete**). This emits a `DeviceDeleted` event — the projection row is dropped, the events table keeps the history, the control server stops enqueueing actions for it — **and revokes the device's mTLS certificate**: its fingerprint lands on the Valkey-backed CRL, and the gateway rejects the cert at its next connection attempt instead of trusting it until its 1-year expiry.
2. **Uninstall the agent** on the host: `sudo apt remove power-manage-agent` (or distro equivalent). The agent's local state lives under `/var/lib/power-manage/`; remove that directory too if you want the credentials gone.
<!-- docref: end -->

{% callout type="note" title="Revocation rides deletion" %}
There is no standalone `RevokeCertificate` RPC — deleting the device *is* the revocation lever (and every certificate renewal revokes the superseded cert automatically). The gateway's revocation check is fail-closed: it refuses to boot without loading the list, and keeps the last snapshot through a Valkey blip. See [mTLS and signed actions](/security/mtls).
{% /callout %}

## "What happens if Postgres goes down?"

The control server returns errors for any RPC that needs to read or write state. The gateway keeps streaming to connected agents (it doesn't have Postgres), but new dispatches can't be enqueued because the control server can't produce them.

<!-- docref: begin src=agent:internal/scheduler/scheduler.go#Scheduler:29adb32b -->
Agents keep doing their scheduled work: the offline scheduler executes from the agent's local action store (re-verifying each stored signed envelope before running it) and re-syncs once the control plane is back.
<!-- docref: end -->

So: short outages (minutes) are invisible to most operators. Long outages (hours) delay anything that needed a fresh dispatch, but converged-state actions continue running on agents.

## "What happens if Redis/Valkey goes down?"

The Asynq queues and the search indexes live there. Concretely:

<!-- docref: begin src=server:deploy/valkey.conf.template:92f3972a -->
- **New action dispatches** fail at the enqueue step while it's down. The control server returns an error to the operator.
- **Search** stops working. Listing devices/users/actions still works (those come from Postgres projections); free-text search doesn't.
- **Queued tasks survive a restart.** The stack runs Valkey with `appendonly yes` on a bind-mounted volume, so tasks already enqueued are recovered when the container comes back. What's lost is whatever operators *tried* to enqueue during the outage — those calls failed loudly at dispatch time.
- **Agents' bidi streams** stay open (they don't talk to Valkey directly), but the gateway also fail-closes new mTLS admissions if its revocation-list cache has never loaded — a gateway restarted *during* a Valkey outage won't come up until Valkey returns.
<!-- docref: end -->

If the search indexes come back stale or missing, trigger `RebuildSearchIndex` (web UI: **Settings** → **Search** → **Rebuild index**).

For HA, the Compose stack isn't the right shape. Switch to a Valkey replica setup with Sentinel or run on a managed Redis-compatible service.

## "Action vs. compliance policy: which do I use when?"

| If you want... | Use |
|---|---|
| The agent to make the assertion true | Assignment, `REQUIRED` mode |
| To know about drift but not fix it | Compliance policy |
| To know AND have the agent fix it | Both, assignment + policy with the same check |

The line is "make it so" vs. "tell me about it". See [Compliance](/concepts/compliance) for the full split.

## "How do I run a dev environment without affecting production?"

Run two complete stacks on different domains: `control-dev.example.com` and `control.example.com`. Same agent binary, different enrolment tokens. The hosted web UI connects to whichever you type into its server field.

For most operators, "dev" is a staging host that mirrors prod. For per-developer environments, run the Compose stack locally on `*.localhost` (the docs server's `vite.config.ts` already allows that hostname).

## "Can I have multiple admins?"

<!-- docref: begin src=server:internal/store/migrations/008_seeds.sql:68a06c9b -->
Yes. The `Admin` role is just a seeded role carrying the full permission set; it's not special. Create users, then call `AssignRoleToUser` to grant them Admin (web UI: **Users** → user-detail → **Roles** → add). Or build your own admin-equivalent role from `CreateRole` + the subset of permissions you actually want to grant.
<!-- docref: end -->

Treat the bootstrap admin (from `ADMIN_EMAIL` / `ADMIN_PASSWORD`) as break-glass once you have at least one real admin: switch off password auth (`CONTROL_PASSWORD_AUTH_ENABLED=false`) and you'll only reach it by toggling that back on.

## "Where do I file bugs?"

Pick the repo that matches the surface:

- [`manchtools/power-manage-server`](https://github.com/manchtools/power-manage-server/issues) — control server, gateway, indexer.
- [`manchtools/power-manage-agent`](https://github.com/manchtools/power-manage-agent/issues) — the agent binary and its executors.
- [`manchtools/power-manage-sdk`](https://github.com/manchtools/power-manage-sdk/issues) — proto definitions, generated Go / TS code, SDK system primitives.
- [`manchtools/power-manage-web`](https://github.com/manchtools/power-manage-web/issues) — web UI.

Include the server version (logged on container startup with `docker compose logs control --since=24h | grep '"starting control server"'`), a reproducer, and any relevant logs.
