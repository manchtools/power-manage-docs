# SSH

Grants a list of users SSH access by managing a dedicated Linux group plus an `sshd_config.d` drop-in that allows the group. Different from `USER`'s `ssh_authorized_keys` field, which manages the keys themselves. `SSH` controls *who* can SSH, not *with what key*.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `allow_pubkey` | bool | no | `true` | Allow public-key authentication. |
| `allow_password` | bool | no | `false` | Allow password authentication. |
| `users` | string[] | no | — | Usernames to grant SSH access. Each 1–32 chars. |

## How it works

The agent creates a Linux group named `pm-ssh-<actionId>` (hashed to 32 chars if the action ID is long). It writes an `sshd_config.d/<priority>-pm-ssh-<actionId>.conf` drop-in with a `Match Group` directive that allows the listed authentication methods for the group. Members of `users` are added to the group. `sshd` is reloaded.

## Idempotency

The agent checks three things: group membership matches `users` exactly, the drop-in file content matches the desired auth methods, and `sshd` is reloaded if anything changed. Matching state means `changed=false` and no `sshd` reload.

`desired_state: ABSENT` removes the group, the drop-in, and reloads `sshd`.

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
- Re-naming the action creates a new group and a new drop-in. The agent doesn't garbage-collect the old one automatically; remove the old action with `desired_state: ABSENT` first.
- `allow_password: true` is rarely the right answer. If you must enable it, scope it with an `SSHD` action carrying a `Match Address` directive to constrain source IPs.
