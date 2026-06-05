---
title: SERVICE
---
# SERVICE

Manages a service unit: installed, enabled at boot, and in the desired runtime state. **systemd is the only backend implemented today.** OpenRC, runit, and s6 are reserved as enum values so the proto doesn't need a rename when those land — picking one of them today fails the action with `ErrBackendNotSupported` (`service backend not supported: <op> on backend <name>`).

The `unit_content` field is what you'd put in a `.service` file. Set it and the agent writes the file before evaluating state. Leave it unset and the agent assumes the unit already exists, only managing enable and state.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `unit_name` | string | yes | — | Unit name (e.g. `nginx.service`). Max 255 chars. |
| `desired_state` | enum | yes | — | `STARTED`, `STOPPED`, or `RESTARTED`. |
| `enable` | bool | no | `true` | Enable on boot (or disable). |
| `unit_content` | string | no | — | Full unit file body. Max 64 KB. |
| `backend` | enum | no | `SYSTEMD` | `SYSTEMD` (default and the only working value). `OPENRC`, `RUNIT`, `S6` are reserved enum slots; selecting one fails the action. |

## Idempotency

Three things get checked independently.

**Unit content.** If `unit_content` is set, the agent SHA-256s it against the file on disk. Match means no write.

**Enable state.** `systemctl is-enabled` (or the backend equivalent). Match means no `enable` or `disable` call.

**Runtime state.** `systemctl is-active` against `desired_state`. Match means no `start` or `stop`.

`RESTARTED` is deliberately not idempotent. Picking it always restarts the service. Use `STARTED` when you want idempotency.

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

- `power-manage-agent.service` is protected. The agent refuses to manage itself through `SERVICE`. Self-update uses `AGENT_UPDATE` instead.
- A masked unit can't be enabled. If the agent sees a masked unit when `enable: true` is set, it surfaces the error and points at `systemctl unmask`.
- `RESTARTED` runs unconditionally, even on a device where the service was already stopped. The restart there is effectively "stop then start".
- `unit_content` is verbatim. The agent doesn't parse it; if you write a malformed unit file, the systemd reload fails and the action reports it.
