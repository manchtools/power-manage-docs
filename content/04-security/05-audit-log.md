---
title: Audit log
---
# Audit log

<!-- docref: begin src=server:internal/api/audit_handler.go#AuditHandler.ListAuditEvents:e31d3c4f -->
The audit log is not a separate system. It's the `events` table, the same one the projectors derive read state from. State changes, action dispatches, authentication events, and terminal input all land there, and `ListAuditEvents` reads them back out.
<!-- docref: end -->

## What gets recorded

Anything that mutates server-side state, plus the authentication events that matter for compliance.

<!-- docref: begin src=server:internal/eventtypes/types.go#EventType:86edb5e6 -->
**Authentication and identity:**
- Sign-in (`UserLoggedIn` — password, SSO)
- TOTP lifecycle: setup, verification, disable, backup-code consumption, backup-code regeneration
- Role assignments and revocations, user-group changes
- User create / update / disable / delete from any source (manual, SSO, SCIM)
- IdP create / update / disable; SCIM enable / token rotation

**Fleet operations:**
- Device enrolment, certificate signing, certificate renewal (`DeviceCertRenewed`)
- Action create / update / delete; assignment create / delete
- Dispatch (`ExecutionCreated`) and result (`ExecutionCompleted` / `ExecutionFailed` / `ExecutionTimedOut`)
- Maintenance window changes
- Compliance policy state transitions per device

**Privileged actions:**
- Terminal sessions: start, **input** (per chunk — *not* output), stop, force-termination
- LPS password rotation (rotation event; the password itself is redacted on read)
- LUKS key rotation (passphrase redacted on read)
<!-- docref: end -->

<!-- docref: begin src=server:internal/api/auth_handler.go#AuthHandler.Login:b6a2875a -->
Failed sign-ins are rate-limited and logged, but only *successful* sign-ins are recorded as events. A failed `UserLoggedIn` append does not fail the login — it logs an explicit `AUDIT GAP` error instead, so a broken event store is loud without locking everyone out.
<!-- docref: end -->

## How to read it

<!-- docref: begin src=sdk:proto/pm/v1/control.proto#ListAuditEventsRequest:0102d42c -->
The web UI's **Audit** section (backed by `ListAuditEvents`) lets you filter by:

- Actor (`actor_id` — which user / device triggered the event)
- Stream type (`stream_type` — device, user, action, token, …)
- Event type (`event_type`, e.g. `ExecutionCompleted`, `UserDisabled`)

The same filters are available via Connect-RPC for export to a SIEM — it's a paginated unary RPC reading straight from Postgres, not a stream. There is no server-side time-range or outcome filter today; page through and filter client-side if you need those cuts.
<!-- docref: end -->

## Redaction

<!-- docref: begin src=server:internal/api/audit_handler.go#redactEventData:5971a07c,server:internal/api/audit_handler.go#actionRedactionSchemas:c90a68f4,server:internal/api/audit_handler.go#eventRedactionSchemas:5e97c281 -->
Secrets don't come back out of the audit log. Redaction happens **on read**, at the `ListAuditEvents` boundary: the raw event payload stays intact in Postgres (projectors need it), and a schema-aware redactor replaces the known-secret paths with `[REDACTED]` before the payload leaves the API. It is deliberately schema-dispatched per event/action type — not a walk-and-match-by-key-name pass, which would over-scrub and fail open on unknown shapes. What gets scrubbed:

- `script` and `detectionScript` (SHELL and SCRIPT_RUN actions)
- `content` (FILE actions — the body may contain secrets)
- `unitContent` (SERVICE actions — unit files can embed `Environment=` credentials)
- `customConfig` (ADMIN_POLICY actions — sudoers / doas.conf fragments)
- `gpgKey` (REPOSITORY actions — key material; the URL form `gpgKeyUrl` is not scrubbed)
- `presharedKey` (ENCRYPTION actions — LUKS bootstrap entropy)
- `psk` and `clientKey` (WIFI actions — WPA pre-shared key, EAP-TLS client key)
- IdP client secrets, SCIM token hashes, password hashes, LPS passwords, LUKS passphrases, TOTP secrets and backup-code hashes
<!-- docref: end -->

What you see instead is the *event* of the change ("shell action with name X updated"), not the secret value.

Terminal sessions only capture **input** (what the operator typed), not output (what the shell printed). That's a deliberate trade-off — see [Remote terminal access](/security/terminal-access). If your operator pastes a secret as a command argument, it ends up in the audit log. There's no automatic redaction on the input side either.

## Tamper-evidence

<!-- docref: begin src=server:internal/store/migrations/009_v2026_07.sql:c1dc4600 -->
The `events` table is append-only at the **database** level, not just by application convention: a `BEFORE` trigger raises on any `UPDATE` or `DELETE` (row-level) and on `TRUNCATE` (statement-level), so only `INSERT` and `SELECT` succeed — even for an operator with direct DB access or a buggy query.
<!-- docref: end -->

<!-- docref: begin src=server:internal/store/migrations/002_event_store.sql:66e18472 -->
On top of that, every event carries a monotonic sequence number and the `UNIQUE (stream_type, stream_id, stream_version)` constraint enforces optimistic concurrency per stream — two writers can't silently produce conflicting versions of the same stream.
<!-- docref: end -->

If you need stronger guarantees (off-host hash chains, signed periodic checkpoints), the SIEM export is the integration point; cryptographic checkpointing is a deferred item on the [Roadmap](/operations/roadmap).

## Retention

There's no built-in retention policy. The `events` table grows indefinitely. For most deployments that's fine: a million events runs to a few hundred MB.

Pruning the table breaks projector replay (and the append-only trigger refuses the `DELETE` anyway), so don't drop rows. If retention matters for your compliance regime, the supported pattern is:

1. Poll events into your SIEM continuously.
2. Keep a Postgres snapshot at retention boundary (yearly is typical).
3. Trust the SIEM for queries older than the snapshot horizon.

A retention-report tool to estimate the cost of a given retention horizon is on the [Roadmap](/operations/roadmap). The form (CLI subcommand, internal RPC, or dashboard widget) hasn't been decided yet.
