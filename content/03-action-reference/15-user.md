---
title: USER
---
# USER

Creates, modifies, or removes a system user. Covers UID, primary group, home, shell, GECOS comment, SSH authorized_keys, and account disabled / hidden state.

For fine-grained group membership, combine with `GROUP`. For managed `authorized_keys` at the policy level rather than baked into the user record, combine with `SSH`.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `username` | string | yes | — | Linux username. 1–32 chars, starts with a letter. |
| `uid` | int32 | no | auto | User ID. 0–65534. |
| `gid` | int32 | no | auto | Primary group ID. 0–65534. |
| `primary_group` | string | no | — | Primary group name (creates the group if missing). Alternative to `gid`. |
| `home_dir` | string | no | `/home/<username>` | Home directory path. Absolute. |
| `shell` | string | no | `/bin/bash` | Login shell. |
| `ssh_authorized_keys` | string[] | no | — | SSH public keys to add to `~/.ssh/authorized_keys`. Each max 4096 chars. |
| `comment` | string | no | — | GECOS field. Max 255 chars. |
| `system_user` | bool | no | `false` | Create as a system user (UID < 1000). |
| `create_home` | bool | no | `true` for normal, `false` for system | Create the home directory. |
| `disabled` | bool | no | `false` | Disable the account (lock password, shell to nologin). |
| `hidden` | bool | no | `false` | Hide from GUI login screens (sets SystemAccount in AccountsService). |

## Idempotency

The agent checks each field individually against the device's current state (`getent passwd`, `cat ~/.ssh/authorized_keys`, AccountsService for `hidden`). Mismatched fields are updated, matching ones are skipped.

`desired_state: ABSENT` removes the user. The home directory is removed by default; pass `create_home: false` in the same action to keep the home intact.

## Example

A regular user with SSH key access:

```yaml
type: USER
username: alice
shell: /bin/zsh
comment: "Alice Liddell, ops"
ssh_authorized_keys:
  - "ssh-ed25519 AAAA... alice@laptop"
desired_state: PRESENT
```

A system user for a service account:

```yaml
type: USER
username: myapp
system_user: true
shell: /usr/sbin/nologin
home_dir: /var/lib/myapp
primary_group: myapp
desired_state: PRESENT
```

Disable a former employee's account without deleting it:

```yaml
type: USER
username: bob
disabled: true
desired_state: PRESENT
```

## Gotchas

- The agent refuses to manage the user that owns the agent process itself. Disabling `root` through `USER` is rejected.
- `linux_uid` autoassignment uses the next free UID in the normal range (or system range if `system_user: true`). To pin a UID across a fleet, set `uid` explicitly.
- SSH keys are managed via append-if-missing semantics. For pure additive policy that never removes keys outside its list, use the `SSH` action instead.
- `hidden` requires `accountsservice` installed; otherwise the field is ignored and a warning ends up in the audit log.
