# FAQ

Short answers to questions that come up often. For symptom-level "this is broken" investigation, see [Troubleshooting](/operations/troubleshooting).

## "Is there a web UI?"

Yes, but it's a separate hosted service and not bundled with the server stack. The server exposes a Connect-RPC API; the UI at **https://app.power-manage.manchtools.com** points at your control server in your browser. See [The web UI](/get-started/web-ui) for the trust model. Your data never touches the UI host.

The UI is not open-source and isn't shipped for self-hosting. If you need an on-premise client (compliance, custom workflows), build one against the Connect-RPC API. Proto definitions live in [`manchtools/power-manage-sdk`](https://github.com/manchtools/power-manage-sdk).

## "Can I run the agent on Windows or macOS?"

No. Linux only. There is no Windows or macOS build planned. If you need cross-platform endpoint management, this isn't the tool.

The agent depends on Linux-specific subsystems (systemd / OpenRC / runit / s6 for services, LUKS for encryption, package managers, journald, /etc/sudoers, etc.). Porting would be more than a build-target change.

## "How do I rotate the encryption key?"

`CONTROL_ENCRYPTION_KEY` encrypts secrets at rest (IdP client secrets, SCIM bearer tokens, LUKS keys, LPS passwords). Rotating it means re-encrypting every encrypted column in Postgres under the new key.

Procedure:

```bash
# 1. Add the new key as a secondary, restart control.
# Both keys decrypt; new writes use the primary.
echo "CONTROL_ENCRYPTION_KEY_PREVIOUS=$(grep ^CONTROL_ENCRYPTION_KEY= .env | cut -d= -f2)" >> .env
sed -i 's/^CONTROL_ENCRYPTION_KEY=.*/CONTROL_ENCRYPTION_KEY=<new 64-hex value>/' .env
docker compose up -d control

# 2. Run the migration that re-encrypts existing rows under the new key.
docker compose exec control power-manage-control rotate-encryption-key

# 3. Once it completes successfully, drop the previous key.
sed -i '/^CONTROL_ENCRYPTION_KEY_PREVIOUS=/d' .env
docker compose up -d control
```

For `PM_TASK_SIGNING_KEY` rotation see [Asynq task signing](/security/task-signing). Different mechanism, documented overlap mode.

## "How do I back up?"

Three things to keep in sync:

| What | How |
|---|---|
| Postgres event store | `pg_dump` of the `powermanage` database. Projections rebuild from events; you don't strictly need them in backup. |
| `.env` | The encryption key in here is what unlocks the event store. Lose it and the backup is useless. |
| CA bundle | If you back up the event store but lose the agent CA, every enrolled agent has to re-enrol. |

Daily `pg_dump` + off-host storage of `.env` + the contents of `deploy/data/ca/` covers all three. The Valkey state (Asynq queues, RediSearch indexes) is regenerable from the event store and doesn't need backup.

## "Can I run multiple gateways?"

Yes. The control server doesn't care which gateway an agent is connected to; agent → gateway routing is done by Traefik's SNI passthrough.

Stand up additional gateway containers on the same `pm-internal` Docker network with unique hostnames. Each gateway self-registers in Valkey on boot, and the control server enqueues tasks per device. Traefik's `gateway` router doesn't load-balance; each gateway accepts whichever agents land on it.

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

## "How do I export the audit log to my SIEM?"

The Connect-RPC API includes a streaming `ListAuditEvents` RPC that takes a time range and filter set. A small Go or TS script that polls hourly is the typical integration. The events come back as JSON; pipe them to your SIEM's ingest endpoint.

```go
stream, err := client.ListAuditEvents(ctx, &pb.ListAuditEventsRequest{
    Since: timestamppb.New(lastCheckpoint),
})
for stream.Receive() {
    forward(stream.Msg())
}
lastCheckpoint = time.Now()
```

A worker example that does this for Splunk and Loki is on the [Roadmap](/operations/roadmap) under "after 2026.06". Until that lands, the pattern above is the path.

## "How do I decommission a device?"

Three steps, in order:

1. **Revoke the agent's certificate** so it can no longer reach the gateway. Device-detail page → **Certificate** → **Revoke**. The fingerprint goes onto a deny-list the gateway checks on every handshake.
2. **Uninstall the agent** from the host: `sudo apt remove power-manage-agent` (or distro equivalent). The agent's local state in `/var/lib/power-manage-agent/` survives if you want to dig through it; `--purge` removes it.
3. **Delete the device record** in the web UI. This emits a `DeviceDeleted` event; projections drop the row, but the events table keeps the history. The audit log remembers the device existed.

The order matters: revoke before delete, so even if the agent reconnects between steps 2 and 3, it can't.

## "What happens if Postgres goes down?"

The control server returns 5xx for any RPC that needs to write or read state. The gateway keeps streaming to connected agents (it doesn't have Postgres), but new dispatches can't be enqueued because the control server can't produce them.

Agents keep doing their current scheduled work using their offline cache. They re-sync once the control server is back. Execution events buffer locally on each agent (up to a configurable size) and ship to the control inbox when the gateway can re-deliver them.

So: short outages (minutes) are invisible to most operators. Long outages (hours) lose any actions that were supposed to be scheduled during the window, but converged-state actions continue running on agents.

## "What happens if Valkey goes down?"

The Asynq queue and the RediSearch indexes are gone. Concretely:

- **New action dispatches** fail at the enqueue step. The control server returns an error to the operator.
- **Search** stops working. Listing devices/users/actions still works (those come from Postgres projections); free-text search doesn't.
- **Already-in-flight tasks** are lost — Asynq is in-memory in Valkey. When Valkey comes back, the queue is empty.
- **Agents' bidi streams** stay open (they don't talk to Valkey directly).

When Valkey restarts, run the indexer's reconciliation manually to rebuild search:

```bash
docker compose exec control power-manage-control reindex --all
```

For HA, the Compose stack isn't the right shape. Switch to a Valkey replica setup with Sentinel or run on a managed Redis-compatible service.

## "Action vs. compliance policy: which do I use when?"

| If you want... | Use |
|---|---|
| The agent to make the assertion true | Assignment, `enforce` mode |
| To know about drift but not fix it | Compliance policy |
| To know AND have the agent fix it | Both — assignment + policy with the same check |

The line is "make it so" vs. "tell me about it". See [Compliance](/concepts/compliance) for the full split.

## "How do I run a dev environment without affecting production?"

Run two complete stacks on different domains: `control-dev.example.com` and `control.example.com`. Same agent binary, different enrolment tokens. The hosted web UI connects to whichever you type into its server field.

For most operators, "dev" is a staging host that mirrors prod. For per-developer environments, run the Compose stack locally on `*.localhost` (the docs server's `vite.config.ts` already allows that hostname).

## "Can I have multiple admins?"

Yes. The `Admin` role is just a seeded role with all permissions; it's not special. Create users, assign them the Admin role from **Users** → user-detail → **Roles**. Or build your own admin-equivalent role with the subset of permissions you actually want to grant.

Treat the bootstrap admin (from `ADMIN_EMAIL` / `ADMIN_PASSWORD`) as break-glass once you have at least one real admin: switch off password auth (`CONTROL_PASSWORD_AUTH_ENABLED=false`) and you'll only reach it by toggling that back on.

## "Where do I file bugs?"

[`manchtools/power-manage-server`](https://github.com/manchtools/power-manage-server/issues) for the server stack, `power-manage-agent` for agent issues, `power-manage-sdk` for proto / SDK questions. Include version (`docker compose exec control power-manage-control version`), a reproducer, and any relevant logs.
