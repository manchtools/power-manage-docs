---
title: "Audit events for secret reads (LPS / LUKS)"
status: draft
created: 2026-07-04
---

# Audit events for secret reads (LPS / LUKS)

## Overview

`GetDeviceLpsPasswords` and `GetDeviceLuksKeys` return **decrypted** credential
material to an authorized operator but append **no audit event** — there is no
record of who retrieved which device's password/key, when. This spec adds
`LpsPasswordsViewed` / `LuksKeysViewed` audit events on the success path of each
read (no secret material in the payload), surfaced in `ListAuditEvents`. It is
the read-side complement to the write-side audit-completeness work (#496) and
closes server#494.

## Motivation

Retrieving a device's break-glass password or LUKS key is one of the most
security-sensitive operations in the product, and it is exactly the class of
access a NIS2/SOC 2 audit expects to be logged (cf. LAPS password-retrieval
auditing in AD). The project rule "every state-changing RPC is audit-logged"
doesn't reach reads — but secret-returning reads are the standard exception where
read auditing is required. Both docs pages previously *claimed* this auditing
existed; this makes it true.

## Acceptance criteria

1. Given an authorized `GetDeviceLpsPasswords`, when it returns, then an
   `LpsPasswordsViewed` event is appended (actor, device, timestamp, and *which*
   entries were returned by username/rotation-id — **never** the password),
   before the response.
2. Given an authorized `GetDeviceLuksKeys`, when it returns, then a
   `LuksKeysViewed` event is appended (actor, device, timestamp, key identifiers —
   **never** the passphrase).
3. Given a rejected read (unauthenticated, wrong role, out-of-scope → NotFound,
   or a decrypt failure), when it fails, then **no** view event is appended.
4. Given the view events, when `ListAuditEvents` is queried, then they appear
   with the actor/device/time and are covered by the read-side redaction schema
   (no secret material can leak through the audit API).
5. Given a successful read, when it appends the event, then exactly **one** event
   is appended per call (not one per returned entry, unless the design chooses
   per-entry — see Out of scope).

## Out of scope

- Auditing *failed authorization attempts* beyond the existing interceptor logs.
- Per-entry vs per-call granularity is drafted as **per-call** (one event listing
  the identifiers); per-entry is a heavier alternative if forensic granularity is
  required — decision left open, per-call default.
- Changing the read RPCs' authorization (unchanged).

## Technical design

### Affected packages

- `server/internal/eventtypes` (+ `payloads`) — `LpsPasswordsViewed`,
  `LuksKeysViewed` typed payloads (identifiers only, no secrets).
- `server/internal/api/device_handler.go` — append on the success path of
  `GetDeviceLpsPasswords` / `GetDeviceLuksKeys` (after authz + decrypt, before
  returning); an append failure logs `AUDIT GAP` but does not fail the read (the
  material was already returned — same contract as the #496 dispatch audits).
- Redaction schemas — ensure the new event types carry no secret material and
  are covered.

### Database changes

- Two new event types (audit-only; they record a *view*, not a domain mutation —
  the events table is the audit log). These are reads that voluntarily append;
  the #498 append-completeness guard classifies them as reads and does not
  require it, but does not forbid it.

### New dependencies

None.

## Security considerations

- **No secret material in payloads** — identifiers only; redaction-schema pinned.
- **Best-effort append after a successful read**: the credential was already
  handed to the authorized caller, so a post-read append failure is logged loudly
  (`AUDIT GAP`) but cannot un-return the secret — mirrors the #496 contract.
- **Reads are low-frequency** (an operator retrieving a break-glass secret), so
  auditing every read carries no noise concern.

## Test requirements

- Success → exactly one view event with correct actor/device/identifiers, no
  secret material; `ListAuditEvents` shows it; redaction verified.
- Rejection (unauth / wrong role / out-of-scope NotFound / decrypt failure) →
  zero view events.
- Payload never contains a password/passphrase (assert on the stored event).

## Rejection paths

| Scenario | Error code | Client message | Logged context |
|---|---|---|---|
| Unauthenticated read | Unauthenticated | (interceptor) | method, remote |
| Wrong role / out-of-scope | NotFound | "device not found" | actor, device |
| Decrypt failure on stored material | Internal | "failed to decrypt" | device, "no view event appended" |
| View append fails post-read | (log `AUDIT GAP`) | (read still succeeds) | actor, device, error |

## Rollout and migration

- Additive: two event types + append calls. No migration.

## Rider (same PR)

- Fix the stale comment in `internal/scim/handler.go` ("Discovery endpoints (no
  auth required)") — all three discovery routes are wrapped in `withAuth`; the
  code is correct, the comment lies (audit-adjacent doc fix from the docs sync).

## Audit findings

No `TECH_DEBT_AUDIT.md` finding is specific to this (it was tracked separately as
#494). Related: the write-side audit-completeness guard (#496/#498) covers
mutations; this covers the secret-returning-read exception the guard intentionally
does not.

## References

- server#494; the #496 dispatch-audit pattern (best-effort post-action append).
