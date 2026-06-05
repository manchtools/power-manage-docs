---
title: SSHD
---
# SSHD

Manages `sshd_config` through priority-ordered drop-in fragments under `/etc/ssh/sshd_config.d/`. Each `SSHD` action lays down one fragment with one or more directives. Multiple `SSHD` actions can coexist; ordering is controlled by `priority`.

For "who can SSH at all", use [`SSH`](/action-reference/identity-and-access/ssh). For "what `sshd` does globally", use this.

## Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `priority` | uint32 | no | Drop-in ordering. Lower loads first. Server auto-assigns; agents don't pick it. |
| `directives` | object[] | yes | At least one directive. |
| `directives[].key` | string | yes | sshd_config directive name. Max 128 chars. |
| `directives[].value` | string | yes | Directive value. Max 1024 chars. |

## Idempotency

The agent hashes the generated fragment content and compares against the file on disk. Match means no write and no `sshd` reload. Mismatch rewrites the fragment and runs `systemctl reload sshd`.

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

- Directives are written verbatim. The agent doesn't validate syntax. A malformed value lands in the file and the `sshd` reload fails. The action reports the failure.
- `priority` is auto-assigned by the server based on action creation order. Manual reordering means editing the priority in the web UI, which triggers a re-write of the fragment with the new number.
- Drop-in files override `sshd_config` only for directives `sshd` recognises as overridable. Some directives (`Subsystem`, certain log settings) take only the first occurrence; check your `sshd` version.
- **No `Match` block support today.** Each entry in `directives[]` becomes a single `key value` line. A `Match` directive on its own line — without sub-directives on the lines that follow — isn't valid sshd_config. If you need a conditional block (`Match Address`, `Match User`, etc.) drop a raw file with the `FILE` action instead; expanding `SSHD` to model `Match` blocks is parked in the action-extensions backlog.
