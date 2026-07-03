---
title: SSHD
---
# SSHD

Manages `sshd_config` through priority-ordered drop-in fragments under `/etc/ssh/sshd_config.d/`. Each `SSHD` action lays down one fragment (`<priority, zero-padded>-pm-<actionId>.conf`) with one or more directives. Multiple `SSHD` actions can coexist; ordering is controlled by `priority`.

For "who can SSH at all", use [`SSH`](/action-reference/identity-and-access/ssh). For "what `sshd` does globally", use this.

## Parameters

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#SshdParams:0404be19,sdk:proto/pm/v1/actions.proto#SshdDirective:2012e676 -->
| Field | Type | Required | Description |
|---|---|---|---|
| `priority` | uint32 | no | Drop-in ordering. Lower loads first. Server auto-assigns; agents don't pick it. |
| `directives` | object[] | yes | At least one directive. |
| `directives[].key` | string | yes | sshd_config directive name. 1–128 chars. |
| `directives[].value` | string | yes | Directive value. 1–1024 chars. |
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/action_ssh.go#Executor.setupSshdConfig:52af2043,agent:internal/executor/helpers.go#Executor.writeAndValidateConfig:207cd164,agent:internal/executor/action_user.go#reloadSshd:2e34268d -->
The agent generates the fragment content and compares it against the file on disk. Match means no write and no `sshd` reload. Mismatch rewrites the fragment, validates it with `sshd -t` (removing the file and failing the action if validation fails), and reloads the `sshd` service (falling back to the Debian/Ubuntu `ssh` unit name).
<!-- docref: end -->

## Example

Force protocol 2, disable challenge-response, set a banner:

```yaml
type: SSHD
directives:
  - { key: Protocol, value: "2" }
  - { key: ChallengeResponseAuthentication, value: "no" }
  - { key: Banner, value: "/etc/issue.net" }
desired_state: PRESENT
```

Restrict root login to keys only:

```yaml
type: SSHD
directives:
  - { key: PermitRootLogin, value: "prohibit-password" }
desired_state: PRESENT
```

## Gotchas

<!-- docref: begin src=agent:internal/executor/helpers.go#Executor.writeAndValidateConfig:207cd164 -->
- Directive keys and values are written verbatim (control characters are rejected), but the whole fragment is validated with `sshd -t` before it takes effect. A malformed value never lands: the invalid fragment is removed and the action reports the validation failure.
<!-- docref: end -->
<!-- docref: begin src=server:internal/api/action_crud.go#ActionHandler.CreateAction:0ddb0654,server:internal/api/action_crud.go#ActionHandler.UpdateActionParams:e51f8a16 -->
- `priority` is assigned by the server at creation time (the count of existing SSHD actions) and **preserved across parameter updates** — you can't edit it later. To change the load order, delete the action and recreate it in the desired sequence.
<!-- docref: end -->
- Drop-in files override `sshd_config` only for directives `sshd` recognises as overridable. Some directives (`Subsystem`, certain log settings) take only the first occurrence; check your `sshd` version.
<!-- docref: begin src=agent:internal/executor/action_ssh.go#generateSshdGlobalConfig:a3971b09 -->
- **No `Match` block support today.** Each entry in `directives[]` becomes a single `key value` line, and keys/values containing newlines are rejected outright. A `Match` directive on its own line — without sub-directives on the lines that follow — isn't valid sshd_config. If you need a conditional block (`Match Address`, `Match User`, etc.) drop a raw file with the `FILE` action instead; expanding `SSHD` to model `Match` blocks is parked in the action-extensions backlog.
<!-- docref: end -->
