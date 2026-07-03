---
title: SERVICE
---
# SERVICE

<!-- docref: begin src=sdk:sys/service/service.go#New:91064f53,agent:cmd/power-manage-agent/backend.go#applyBackendOverrides:7377f3da -->
Manages a service unit: installed, enabled at boot, and in the desired runtime state. **systemd is the only backend implemented.** OpenRC, runit, and s6 exist as reserved enum values in the proto so a future backend doesn't churn the wire format, but the SDK builds only a systemd manager and the agent refuses to start without `systemctl` on PATH. Requesting a non-systemd backend via the agent's `POWER_MANAGE_SERVICE_BACKEND` environment variable logs a loud startup warning and every SERVICE action on that host fails.
<!-- docref: end -->

The `unit_content` field is what you'd put in a `.service` file. Set it and the agent writes the file before evaluating state. Leave it unset and the agent assumes the unit already exists, only managing enable and state.

## Parameters

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#ServiceParams:bdf30b85,sdk:proto/pm/v1/actions.proto#ServiceUnitState:fcffc2f4,sdk:sys/service/systemd.go#ValidateUnitName:b5a98d4d -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `unit_name` | string | yes | — | Full unit name **including its type suffix** (e.g. `nginx.service`, `telnet.socket`). Max 255 chars; the agent validates it against systemd's unit-name grammar. |
| `desired_state` | enum | no | — | `STARTED`, `STOPPED`, or `RESTARTED`. Unset leaves the runtime state alone — the action then only manages `unit_content` and `enable`. |
| `enable` | bool | no | `false` | Enable at boot. **Unset means `false`, which actively disables an enabled unit** — there is no "leave it alone" value. |
| `unit_content` | string | no | — | Full unit file body. Max 64 KB. |
| `backend` | enum | no | `SYSTEMD` | Reserved. The agent currently ignores this field — its service backend is fixed at startup, and only systemd is implemented. |
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/action_service.go#Executor.executeService:c2202793 -->
Three things get checked independently.

**Unit content.** If `unit_content` is set, the agent SHA-256s it against the file on disk (`/etc/systemd/system/<unit_name>`). Match means no write; a change triggers the write plus a daemon-reload.

**Enable state.** `systemctl is-enabled`. Match means no `enable` or `disable` call.

**Runtime state.** `systemctl is-active` against `desired_state`. Match means no `start` or `stop`.

`RESTARTED` is deliberately not idempotent. Picking it always restarts the service. Use `STARTED` when you want idempotency.
<!-- docref: end -->

## Examples

Install + enable + start nginx:

```yaml
type: SERVICE
unit_name: nginx.service
unit_content: |
  [Unit]
  Description=nginx HTTP server
  After=network.target

  [Service]
  ExecStart=/usr/sbin/nginx -g 'daemon off;'
  Restart=on-failure

  [Install]
  WantedBy=multi-user.target
desired_state: STARTED
enable: true
```

Restart an already-installed service after a config change:

```yaml
type: SERVICE
unit_name: nginx.service
desired_state: RESTARTED
```

Stop and disable a legacy service:

```yaml
type: SERVICE
unit_name: telnet.socket
desired_state: STOPPED
enable: false
```

## Gotchas

<!-- docref: begin src=agent:internal/executor/action_service.go#Executor.executeService:c2202793 -->
- `power-manage-agent.service` is protected. The agent refuses to manage itself through `SERVICE` (`cannot manage protected service: power-manage-agent`). Self-update uses `AGENT_UPDATE` instead.
- A masked unit can't be enabled. If the agent sees a masked unit when `enable: true` is set, it fails with `unit <name> is masked (run 'systemctl unmask <name>' first)`.
- Because `enable` defaults to `false`, an action that only means to write `unit_content` for an *enabled* unit will disable it unless you also set `enable: true`. Always state `enable` explicitly.
- `RESTARTED` runs unconditionally, even on a device where the service was already stopped. The restart there is effectively "stop then start".
- `unit_content` is verbatim. The agent doesn't parse it; if you write a malformed unit file, the systemd reload fails and the action reports it.
<!-- docref: end -->
