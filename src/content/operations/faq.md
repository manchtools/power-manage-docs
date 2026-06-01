# FAQ

Short answers to questions that come up often. For symptom-level "this is broken" investigation, see [Troubleshooting](/operations/troubleshooting).

## "Is there a web UI?"

Yes, but it's a separate hosted service and not bundled with the server stack. The server exposes a Connect-RPC API; the UI at **https://app.power-manage.manchtools.com** points at your control server in your browser. See [The web UI](/get-started/web-ui) for the trust model. Your data never touches the UI host.

The UI is not open-source and isn't shipped for self-hosting. If you need an on-premise client (compliance, custom workflows), build one against the Connect-RPC API. Proto definitions live in [`manchtools/power-manage-sdk`](https://github.com/manchtools/power-manage-sdk).

## "Can I run the agent on Windows or macOS?"

No. Linux only. There is no Windows or macOS build planned. If you need cross-platform endpoint management, this isn't the tool.

The agent depends on Linux-specific subsystems (systemd / OpenRC / runit / s6 for services, LUKS for encryption, package managers, journald, /etc/sudoers, etc.). Porting would be more than a build-target change.

## "How do I rotate the encryption key?"

`CONTROL_ENCRYPTION_KEY` encrypts secrets at rest (IdP client secrets, SCIM bearer tokens, LUKS keys, LPS passwords). There's no built-in rotation tooling yet; every encrypted column has to be decrypted with the old key and re-encrypted with the new one as a manual migration.

The honest path today:

1. Stand up a maintenance window: nothing writing to the database. Stop the `control` container.
2. With both old and new keys available, run a Postgres migration script that walks every `*_encrypted` column, decrypts using `old`, re-encrypts using `new`, writes back.
3. Update `CONTROL_ENCRYPTION_KEY` in `.env` to the new value.
4. Restart the control container.

This is tracked as a real CLI subcommand under the upcoming `SECURITY.md` ADR ([Roadmap](/operations/roadmap)) (until then, write the migration script per-deploy or operate as if the key is permanent.

For `PM_TASK_SIGNING_KEY` rotation see [Asynq task signing](/security/task-signing).

## "How do I back up?"

Three things to keep in sync:

| What | How |
|---|---|
| Postgres event store | `pg_dump` of the `powermanage` database. Projections rebuild from events; you don't strictly need them in backup. |
| `.env` | The encryption key in here is what unlocks the event store. Lose it and the backup is useless. |
| CA bundle | If you back up the event store but lose the agent CA, every enrolled agent has to re-enrol. |

Daily `pg_dump` + off-host storage of `.env` + the contents of `deploy/data/ca/` covers all three. The Redis state (Asynq queues, RediSearch indexes) is regenerable from the event store and doesn't need backup.

## "Can I run multiple gateways?"

Yes. The control server doesn't care which gateway an agent is connected to; agent → gateway routing is done by Traefik's SNI passthrough.

Stand up additional gateway containers on the same `pm-internal` Docker network with unique hostnames. Each gateway self-registers in Redis on boot, and the control server enqueues tasks per device. Traefik's `gateway` router doesn't load-balance; each gateway accepts whichever agents land on it.

For high availability, run gateways on separate hosts behind a load balancer or DNS round-robin. Agent reconnects automatically when its current gateway drops.

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

The full RPC surface (164 RPCs) is documented in the proto files at [`manchtools/power-manage-sdk`](https://github.com/manchtools/power-manage-sdk).

## "How do I forward logs / events to my SIEM?"

power-manage does not ship a SIEM integration on the server side, and one isn't planned. The architectural split is:

- **Host-level events** (syslog, journald, file integrity, audit subsystem) are the **agent's** territory. Use the existing host tooling you already deploy via power-manage (`filebeat`, `vector`, `fluent-bit`, `auditbeat`, whatever your SIEM vendor wants) to ship those off-host. The agent is the right place to install and configure these.
- **The audit log on the control server** is the events table in Postgres. The `ListAuditEvents` RPC exposes it for polling-style integrations if you want to write your own bridge, but it's unary (one call returns one page), not a stream. There's no planned server-side SIEM uploader to do this for you.

For the host-tooling path, ship a `SHELL` or `FILE` action that drops the agent vendor's config and a `SERVICE` action that runs the daemon. Same as you'd manage any other system service.

## "How do I decommission a device?"

Two steps:

1. **Delete the device record** via the `DeleteDevice` RPC (web UI: device-detail → **Delete**). This emits a `DeviceDeleted` event. The projection row is dropped, the events table keeps the history (so the audit log remembers the device existed), and the control server stops enqueueing actions for it.
2. **Uninstall the agent** on the host: `sudo apt remove power-manage-agent` (or distro equivalent). The agent's local state lives under `/var/lib/power-manage-agent/`; `--purge` removes it too.

{% callout type="warn" title="Cert revocation isn't implemented yet" %}
The agent's mTLS certificate stays valid until the CA rotates (default 1-year lifetime). The gateway does not currently check a revocation deny-list during the handshake. With no device record on the control plane the cert can't dispatch anything useful, but if you've stopped trusting the host itself (compromise, theft) and want the cert to stop working before its natural expiry, the only options today are CA rotation (re-issues every active agent's cert) or shutting down the gateway. A proper `RevokeCertificate` RPC is on the [Roadmap](/operations/roadmap).
{% /callout %}

## "What happens if Postgres goes down?"

The control server returns 5xx for any RPC that needs to write or read state. The gateway keeps streaming to connected agents (it doesn't have Postgres), but new dispatches can't be enqueued because the control server can't produce them.

Agents keep doing their current scheduled work using their offline cache. They re-sync once the control server is back. Execution events buffer locally on each agent (up to a configurable size) and ship to the control inbox when the gateway can re-deliver them.

So: short outages (minutes) are invisible to most operators. Long outages (hours) lose any actions that were supposed to be scheduled during the window, but converged-state actions continue running on agents.

## "What happens if Redis goes down?"

The Asynq queue and the RediSearch indexes are gone. Concretely:

- **New action dispatches** fail at the enqueue step. The control server returns an error to the operator.
- **Search** stops working. Listing devices/users/actions still works (those come from Postgres projections); free-text search doesn't.
- **Already-in-flight tasks** are lost. Asynq is in-memory in Redis. When Redis comes back, the queue is empty.
- **Agents' bidi streams** stay open (they don't talk to Redis directly).

When Redis restarts, the search index needs to be rebuilt. The control server exposes the `RebuildSearchIndex` RPC for that; in the web UI it's **Settings** → **Search** → **Rebuild index** (available to users with the `RebuildSearchIndex` permission).

For HA, the Compose stack isn't the right shape. Switch to a Redis replica setup with Sentinel or run on a managed Redis-compatible service.

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

Yes. The `Admin` role is just a seeded role with all permissions; it's not special. Create users, then call `AssignRoleToUser` to grant them Admin (web UI: **Users** → user-detail → **Roles** → add). Or build your own admin-equivalent role from `CreateRole` + the subset of permissions you actually want to grant.

Treat the bootstrap admin (from `ADMIN_EMAIL` / `ADMIN_PASSWORD`) as break-glass once you have at least one real admin: switch off password auth (`CONTROL_PASSWORD_AUTH_ENABLED=false`) and you'll only reach it by toggling that back on.

## "Where do I file bugs?"

[`manchtools/power-manage-server`](https://github.com/manchtools/power-manage-server/issues) for the server stack, `power-manage-agent` for agent issues, `power-manage-sdk` for proto / SDK questions. Include the server version (logged on container startup with `docker compose logs control --since=24h | grep '"starting control server"'`), a reproducer, and any relevant logs.
