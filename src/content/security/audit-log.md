# Audit log

The audit log is not a separate system. It's the `events` table, the same one the projectors derive read state from. State changes, action dispatches, authentication events, and terminal bytes all land there.

## What gets recorded

Anything that mutates server-side state, plus a handful of read events that matter for compliance.

**Authentication and authorization:**
- Sign-in success and failure (password, SSO, TOTP, backup code)
- JWT issue and refresh
- Permission grants and revocations
- Role and user-group changes

**Fleet operations:**
- Device enrolment, certificate signing, certificate renewal
- Action create / update / delete
- Assignment create / update / delete
- Dispatch (`ExecutionCreated`) and result (`ExecutionCompleted` / `ExecutionFailed`)
- Maintenance window changes
- Compliance policy state transitions per device

**Identity:**
- User create / update / delete from any source (manual, SSO, SCIM)
- IdP create / update / disable
- SCIM provisioning operations

**Privileged actions:**
- Terminal sessions: start, attach, detach, output (per chunk), end
- LPS password rotation (rotation event; not the password itself)
- LUKS key rotation
- Bootstrap-admin sign-in (called out explicitly)

## How to read it

The web UI's **Audit** section (backed by `ListAuditEvents`) lets you filter by:

- Actor (which user / agent / IdP triggered the event)
- Subject (which device / user / group / action the event mutated)
- Event type (e.g. `ExecutionCompleted`, `UserDisabled`)
- Time range
- Outcome (success, failure)

The same filters are available via Connect-RPC for export to a SIEM. RediSearch indexes back the query path so even multi-month searches stay fast.

## Redaction

Secrets don't appear in the audit log. The redactor strips these fields before write:

- `script` and `detectionScript` (shell actions)
- `content` (file actions where the body may be sensitive)
- `customConfig` (sshd_config overrides)
- `gpgKey` (repository signing keys)
- `presharedKey` (Wi-Fi profiles)
- IdP client secrets, SCIM bearer tokens, LPS passwords, LUKS passphrases

What gets recorded instead is the *event* of the change ("ssh action with name X updated"), not the new secret value. The encrypted secret lives in Postgres separately, scoped to the operations that need it.

Terminal sessions are an explicit exception: the full input/output stream is recorded. If your operator types a secret into a terminal, it ends up in the audit log. There's no automatic redaction inside session output.

## Tamper-evidence

The `events` table is append-only at the schema level: no `UPDATE` privilege on the table for the application role, and the `UNIQUE (stream_type, stream_id, stream_version)` constraint catches gap-filling attempts. Every event carries an actor and a monotonic sequence number.

If you need stronger guarantees (off-host hash chains, signed periodic checkpoints), the SIEM export is the integration point. The 2026.06 milestone is finalising the ADR on cryptographic checkpointing. See [Roadmap](/operations/roadmap).

## Retention

There's no built-in retention policy. The `events` table grows indefinitely. For most deployments that's fine: a million events runs to a few hundred MB.

Pruning the table breaks projector replay, so don't drop rows. If retention matters for your compliance regime, the supported pattern is:

1. Stream events to your SIEM continuously.
2. Keep a Postgres snapshot at retention boundary (yearly is typical).
3. Trust the SIEM for queries older than the snapshot horizon.

The control server's `doctor` subcommand (landing in 2026.06) will include a retention-report tool to estimate the cost of a given retention horizon.
