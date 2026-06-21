---
title: "Enrollment token management"
status: implemented
created: 2026-01-15
---

# Enrollment token management

## Overview

Device enrollment tokens are the credential agents present during the
socket-based enrollment flow. This spec covers creating, listing,
renaming, disabling, and deleting tokens. Token creation is the only
RPC that returns the token value; all subsequent reads return metadata
only.

## Motivation

Agents need a registration token to authenticate during enrollment.
Operators need to manage these tokens: create them with specific
ownership, disable compromised tokens, and rotate them. The `:self`
scope lets non-admin users create one-time tokens for their own devices
without granting broader token management privileges.

## Acceptance criteria

1. **Admin creates a token** — Given an admin-authenticated context,
   when CreateToken is called with a name, then the response contains a
   new token with a non-empty ID, the requested name, and a non-empty
   value. The value is only returned on creation.
2. **Admin sets owner to self** — Given an admin, when CreateToken is
   called with `owner_id` set to the admin's own ID, then the token's
   owner is that admin.
3. **Admin sets owner to another user** — Given an admin, when
   CreateToken is called with `owner_id` set to a different user's ID,
   then the token's owner is that other user.
4. **Owner not found** — Given an admin, when CreateToken is called with
   a syntactically valid ULID that doesn't match any user, then the RPC
   returns NotFound.
5. **User creates a token — :self scope override** — Given a
   non-admin user, when CreateToken is called with `owner_id` set to a
   different user's ID, then the token is owned by the calling user
   (the `:self` scope forces self-ownership) and the token is marked
   `one_time: true`.
6. **Token value not leaked on Get** — Given a token created earlier,
   when GetToken is called, then the response contains the token
   metadata but the value field is empty.
7. **List returns all tokens** — Given multiple tokens exist, when
   ListTokens is called, then the response contains at least the
   number of created tokens.
8. **Rename changes only the name** — Given an existing token, when
   RenameToken is called with a new name, then the response reflects
   the new name and all other fields are unchanged.
9. **Disable and re-enable toggle** — Given a token, SetTokenDisabled
   can toggle the disabled flag from false to true and back.
10. **Delete removes the token** — Given a token, when DeleteToken is
    called, then subsequent GetToken returns NotFound.

## Out of scope

- Token value rotation (separate spec)
- Token usage tracking / last-used-at timestamp
- Token expiry / TTL
- Bulk token operations

## Technical design

### Affected packages

- `server/internal/api` — new TokenHandler with CreateToken, GetToken,
  ListTokens, RenameToken, SetTokenDisabled, DeleteToken RPCs
- `sdk/proto/pm/v1/control.proto` — new TokenService messages and RPC
  definitions
- `server/internal/store` — new event types for token lifecycle events

### Proto changes

New messages: `CreateTokenRequest`, `CreateTokenResponse`,
`GetTokenRequest`, `GetTokenResponse`, `ListTokensRequest`,
`ListTokensResponse`, `RenameTokenRequest`, `RenameTokenResponse`,
`SetTokenDisabledRequest`, `SetTokenDisabledResponse`,
`DeleteTokenRequest`, `DeleteTokenResponse`, `Token`.

Every request ID field carries `@gotags validate:"ulid"`. The
`CreateTokenRequest.owner_id` field is optional (admin may omit).

### Database changes

New event types: `TokenCreated`, `TokenRenamed`, `TokenDisabled`,
`TokenDeleted`. Projection table `token_projection` with columns: id,
name, owner_id, one_time, disabled, created_at, updated_at.

### New dependencies

None. All existing infrastructure (Postgres event store, Connect-RPC).

## Security considerations

- **Authorization**: CreateToken allows users with `create_token:assigned`
  or admin scope. The `:self` scope forces `owner_id` to the caller's
  own ID — the handler must override any caller-supplied value, not
  merely reject mismatches.
- **Input validation**: `owner_id` when present must be a valid ULID
  that resolves to an existing user, validated at the handler level
  (not just proto validation).
- **Secrets**: The token value (a random 256-bit hex string, generated
  via `crypto/rand`) must never appear in log fields, error messages,
  or audit entries. It is returned exactly once (in CreateToken
  response) and stored as a SHA-256 hash in the database.
- **Audit**: CreateToken, RenameToken, SetTokenDisabled, and
  DeleteToken are state-changing RPCs and must be audit-logged.

## Test requirements

### Handler tests

Each test uses a real Postgres via `testutil.SetupPostgres(t)`, a real
handler via `api.NewTokenHandler`, and authenticated contexts via
`testutil.AdminContext` / `testutil.UserContext`. No mocks.

| Test function | Covers acceptance criteria | Covers rejection path |
|---|---|---|
| `TestCreateToken_Admin` | AC 1 | — |
| `TestCreateToken_Admin_OwnerSelf` | AC 2 | — |
| `TestCreateToken_Admin_OwnerOtherUser` | AC 3 | — |
| `TestCreateToken_Admin_OwnerNotFound` | — | AC 4 (NotFound) |
| `TestCreateToken_User` | AC 5 | — |
| `TestGetToken` | AC 6 | — |
| `TestListTokens` | AC 7 | — |
| `TestRenameToken` | AC 8 | — |
| `TestSetTokenDisabled` | AC 9 | — |
| `TestDeleteToken` | AC 10 | — |

### Missing coverage (to add)

- Unauthenticated context → PermissionDenied (not Unauthenticated, the
  interceptor handles that)
- Non-admin, non-`:assigned` user → PermissionDenied
- RenameToken with invalid ULID → InvalidArgument
- SetTokenDisabled on nonexistent token → NotFound
- DeleteToken on already-deleted token → NotFound (idempotent or
  reject?)

## Rejection paths

| Scenario | Error code | Client-visible message | Logged context |
|----------|-----------|----------------------|----------------|
| owner_id is valid ULID but user doesn't exist | NotFound | "owner not found" | owner_id, operation=CreateToken |
| Non-admin user without `:assigned` scope | PermissionDenied | "permission denied" | user_id, operation=CreateToken |
| Token ID not found for Get/Rename/Disable/Delete | NotFound | "token not found" | token_id, operation=… |
| Deleted token accessed again | NotFound | "token not found" | token_id, operation=GetToken |
