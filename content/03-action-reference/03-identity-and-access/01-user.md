---
title: USER
---
# USER

Creates, modifies, or removes a system user. Covers UID, primary group, home, shell, GECOS comment, SSH authorized_keys, and account disabled / hidden state.

For fine-grained group membership, combine with `GROUP`. For managed `authorized_keys` at the policy level rather than baked into the user record, combine with `SSH`.

## Parameters

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#UserParams:43c50847,sdk:sys/user/user.go#IsValidName:32396361 -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `username` | string | yes | — | Linux username. 1–32 alphanumeric chars; the agent additionally requires a lowercase first letter. |
| `uid` | int32 | no | auto | User ID. 0–65534. The agent only pins a UID when the value is > 0. |
| `gid` | int32 | no | auto | Primary group ID. 0–65534. Only applied when > 0. |
| `primary_group` | string | no | — | Primary group name (creates the group if missing). Alternative to `gid`; a `gid` > 0 wins. Max 32 chars. |
| `home_dir` | string | no | `/home/<username>` | Home directory path. Absolute. |
| `shell` | string | no | `/bin/bash` | Login shell. Absolute path. Unset defaults to `/bin/bash` for normal users, `/usr/sbin/nologin` for `system_user` or `disabled` accounts. |
| `ssh_authorized_keys` | string[] | no | — | SSH public keys for `~/.ssh/authorized_keys`. Each max 4096 chars. |
| `comment` | string | no | — | GECOS field. Max 255 chars. |
| `system_user` | bool | no | `false` | Create as a system user (UID < 1000). |
| `create_home` | bool | no | `false` | Create the home directory. The agent honours the explicit value — an unset/false field means no home is created. The web UI pre-checks this for normal users. |
| `disabled` | bool | no | `false` | Disable the account (lock password, shell to nologin). |
| `hidden` | bool | no | `false` | Hide from GUI login screens (sets SystemAccount in AccountsService). |
| `no_password` | bool | no | `false` | Skip the temporary-password generation entirely; the account stays at the shadow-locked `!` default. Meant for system-managed nologin accounts reached only via setuid (`pm-tty-*`); do not set it for general-purpose users. |
<!-- docref: end -->

<!-- docref: begin src=agent:internal/executor/action_user.go#Executor.createUser:9a526821,agent:internal/executor/action_user.go#createUserSetsPassword:89c9052b -->
On creation of a plain enabled account (none of `no_password` / `system_user` / `disabled` set), the agent generates a random 16-char temporary password, sets it, and expires it so it must be changed on first login. The temporary password is reported back to the server sealed to the control LPS public key — the gateway never sees it in cleartext.
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/action_user.go#Executor.updateUser:50055ffa -->
The agent checks each field individually against the device's current state (the passwd entry, `~/.ssh/authorized_keys` content, the AccountsService override for `hidden`). Mismatched fields are updated, matching ones are skipped; nothing to change reports `changed=false`.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/executor/action_user.go#Executor.removeUser:9bb20cfd -->
`desired_state: ABSENT` removes the user. The agent kills the user's sessions first, then runs the removal with home-directory deletion always enabled — there is no flag to keep the home. Back up the home directory before deleting an account if you need it.
<!-- docref: end -->

## Example

A regular user with SSH key access:

```yaml
type: USER
username: alice
shell: /bin/zsh
comment: "Alice Liddell, ops"
create_home: true
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

<!-- docref: begin src=agent:internal/executor/action_user.go#Executor.removeUser:9bb20cfd -->
- The agent refuses to remove its own service user: `desired_state: ABSENT` for `power-manage` is rejected. That is the only protected name — there is no built-in guard against disabling `root`, so be deliberate with the `disabled` flag.
<!-- docref: end -->
- `uid` autoassignment uses the next free UID in the normal range (or system range if `system_user: true`). To pin a UID across a fleet, set `uid` explicitly.
<!-- docref: begin src=agent:internal/executor/action_user.go#Executor.setupSSHKeys:1fd8b218 -->
- SSH keys are managed with exact-content semantics: the agent rewrites `~/.ssh/authorized_keys` to exactly the listed keys (0600, owned by the user). Keys added out-of-band are removed on the next reconciliation. Entries not starting with `ssh-`/`ecdsa-` are skipped with a warning; an entry with an embedded newline fails the whole action.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/action_user.go#setUserHidden:2e91da4a -->
- `hidden` requires `accountsservice` installed (the agent looks for `/var/lib/AccountsService/users/`). On systems without it the field is **silently** skipped — no execution event records the skip today. If you need the GUI-hide behaviour, treat `accountsservice` as a hard prerequisite on the target fleet rather than relying on the audit log to flag it.
<!-- docref: end -->
<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#UserParams.no_password:578574db -->
- `no_password` is deliberately explicit, not derived from `shell: /usr/sbin/nologin`. Setting it closes every PAM-protected login path (password, `su`) for the account permanently — only root setuid invocations still work.
<!-- docref: end -->
