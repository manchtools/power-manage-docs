---
title: SSH
---
# SSH

Grants a list of users SSH access by managing a dedicated Linux group plus an `sshd_config.d` drop-in that allows the group. Different from `USER`'s `ssh_authorized_keys` field, which manages the keys themselves. `SSH` controls *who* can SSH, not *with what key*.

## Parameters

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#SshParams:c8bd2df2,agent:internal/executor/action_ssh.go#Executor.executeSsh:54e5fbc4 -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `allow_pubkey` | bool | no | `false` | Allow public-key authentication. The web UI pre-checks it; an action with the field unset writes `PubkeyAuthentication no`. |
| `allow_password` | bool | no | `false` | Allow password authentication. |
| `users` | string[] | yes | — | Usernames to grant SSH access. Each 1–32 chars. The agent rejects an empty list. |
<!-- docref: end -->

## How it works

<!-- docref: begin src=agent:internal/executor/action_ssh.go#sshGroupName:2ddfb689,agent:internal/executor/action_ssh.go#shortGroupName:acd6b1fe,agent:internal/executor/action_ssh.go#sshConfigPath:9ef48418,agent:internal/executor/action_ssh.go#generateSshGroupConfig:41e8aa4c -->
The agent creates a Linux group named `pm-ssh-<actionId>` (the group name is capped at Linux's 32-char limit; a long action ID gets a stable hash-suffix truncation). It writes an `/etc/ssh/sshd_config.d/pm-ssh-<actionId>.conf` drop-in with a `Match Group` block that sets `PubkeyAuthentication` and `PasswordAuthentication` yes/no for the group. Members of `users` are added to the group. `sshd` is reloaded when the drop-in changes.
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/action_ssh.go#Executor.setupSshAccess:6e505f3b -->
The agent checks two things: the drop-in file content matches the desired auth methods, and group membership matches `users` exactly. Both matching means `changed=false` and no writes. A changed drop-in is validated with `sshd -t` before it counts, then `sshd` is reloaded; a membership-only change syncs the group without touching `sshd`.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/executor/action_ssh.go#Executor.removeSshAccess:4e20ca92 -->
`desired_state: ABSENT` removes the group, the drop-in, and reloads `sshd`.
<!-- docref: end -->

## Example

Pubkey-only access for a specific team:

```yaml
type: SSH
allow_pubkey: true
allow_password: false
users:
  - alice
  - bob
desired_state: PRESENT
```

## Gotchas

- The corresponding `authorized_keys` for each user has to be managed separately. Use `USER` with `ssh_authorized_keys` for that.
- Multiple `SSH` actions can coexist on a device. Each gets its own group + drop-in, so policies stack.
- Re-creating the action creates a new group and a new drop-in (both are named after the action ID). The agent doesn't garbage-collect the old one automatically; remove the old action with `desired_state: ABSENT` first.
<!-- docref: begin src=agent:internal/executor/action_ssh.go#generateSshGroupConfig:41e8aa4c -->
- `allow_password: true` is rarely the right answer. The drop-in only expresses the fixed `Match Group` + auth-method block above; you can't scope password auth to a source-IP range from inside power-manage. If you need that, drop a hand-rolled `sshd_config.d/` fragment via a `FILE` action.
<!-- docref: end -->
