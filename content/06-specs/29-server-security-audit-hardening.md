---
title: "Server security audit hardening"
status: draft
created: 2026-07-11
---

# Server security audit hardening

## Overview

This change hardens five verified server trust boundaries with minimal, testable changes: bind queued-task HMACs to their direction, exact queue, and task type; resolve forwarded client addresses through trusted proxies from right to left; reject and safely log credential-bearing gateway control URLs; redact secret-looking keys in decoded object payloads that have no audit-redaction schema; and replace Traefik's direct Docker socket access with a read-only Docker API proxy.

## Motivation

The current task HMAC authenticates only payload bytes, rate-limit identity trusts the leftmost forwarded address, gateway control configuration can contain and log URL credentials, raw map event payloads can bypass typed audit-redaction coverage, and the reference Traefik deployment has direct Docker daemon access. These are independent defense-in-depth gaps found during the server security audit.

## Evidence matrix

| Candidate | Entry point / caller | Attacker capability and asset | Full path and existing controls | Reachability | Disposition |
|---|---|---|---|---|---|
| Task metadata is not HMAC-bound | Control, gateway, or indexer enqueues through the taskqueue client; Asynq workers verify middleware before handlers | Queue writer or holder of a valid signed task replays bytes under another queue/type; asset is task-handler integrity | Producer marshals then signs payload only; consumer verifies payload only, then dispatches using independently supplied Asynq queue/type. Device-origin handlers additionally enforce the accepted device-to-gateway binding, so shared gateway-key exposure is defense-in-depth rather than an unrestricted cross-device forgery | Production | **HELD** (maintainer, 2026-07-12) — biggest/riskiest, needs a coordinated queue-drain deploy; deferred to a review-available session. Not implemented. |
| Forwarded address takes leftmost hop | Connect API request through a configured trusted proxy; the interceptor's `clientIP` is the sole client-IP resolver (all six rate limiters call it — there is no separate HTTP path) | Client supplies a forged leftmost XFF value; asset is per-IP rate-limit attribution | Direct peers outside the trusted CIDRs already have proxy headers ignored. For a trusted direct peer, current parsing selects the first XFF item rather than walking the trusted chain | Production when trusted proxies are configured | **✅ SHIPPED (server#538)** — one `resolveClientIP` walker (right-to-left, first-untrusted) shared by `clientIP` + `ClientIPFromHTTP` |
| Gateway control URL can contain credentials and is logged raw | Gateway startup configuration | Operator mistake or injected environment includes user-info/query/fragment; asset is credential confidentiality in logs | HTTPS scheme is checked, but the raw configured value is included in startup logs | Production startup | **✅ SHIPPED (#538)** — `config.ValidateControlURL`; rejects user-info/query/fragment, logs only `scheme://host[:port]` |
| Unknown audit object can carry raw-map secrets | Audit list/export converts persisted event data to client-visible strings | A future or legacy raw map append uses an unclassified event and a secret-looking key; asset is stored secret confidentiality | Typed payload tests and schema dispatch protect known payloads. Unknown decoded objects currently pass through unchanged; malformed/non-object payloads are not inspectable as key/value objects | Production audit reads | **✅ SHIPPED (#538)** — recursive deny-set backstop for schemaless events; byte-identical passthrough otherwise |
| Traefik has direct Docker socket access | Reference Compose deployment starts Traefik with Docker provider | Compromised Traefik can call the Docker daemon API; asset is host/container control | The socket bind is marked read-only, which does not restrict Docker API methods. Docker provider discovery still requires container/event reads | Reference production deployment | **DEFERRED** (maintainer, 2026-07-12) — pure defense-in-depth; weighing the added proxy dependency vs. keeping Traefik patched / dropping the Docker provider for static routing. Not implemented. |
| Gateway writes Traefik KV directly | Gateway self-registration writes fixed Traefik keys through its general Valkey backend | Compromised gateway with Valkey credentials can bypass application methods and write arbitrary routing keys | A second credential in the same gateway process would not isolate the capability. A real fix requires a trusted routing writer and Valkey ACL migration | Production in self-register mode | **OPEN finding** — deferred to its own ADR (trusted routing writer + ACL); not implemented by this batch, not closed |
| Sequential SCIM appends are not transactional | Declarative SCIM create/update flows | Mid-sequence storage failure can leave partial projected state; asset is temporary provisioning consistency | Direct append errors return HTTP failures; the IdP reasserts declarative state and projections are idempotent | Production SCIM sync | ~~Accepted risk~~ **RESOLVED by spec 28** — `store.AppendEvents` (transactional multi-stream batch) now makes SCIM `createGroup`/`replaceUser` all-or-nothing; no longer an accepted risk |
| Docker advisories through testcontainers | Test package initialization | Compromised/malicious test container environment; asset is CI/developer Docker host | The Docker module is imported through test infrastructure, not shipped control/gateway runtime paths | Test/CI only | Hygiene item, not a shipped-runtime finding |

## Second-pass audit (2026-07-11)

The five items above were the first hardening batch. A second, broader pass
re-audited the whole server across six trust-boundary lanes — auth/authz/
interceptors, crypto/secrets/PII, the RPC request boundary, store/event-sourcing/
migrations, gateway/inter-service, and idp/sso/scim/ca. Every candidate below was
independently re-verified against the handler code, store queries, proto tags,
and ADRs before being recorded; surfaces that traced clean are omitted. The
crypto and gateway/inter-service surfaces verified **exceptionally hardened**
(all `crypto/rand`, constant-time compares, AAD domain-separation enforced by an
archtest, fail-closed KEK/CRL, server-side CA identity, full device-origin
binding); the items here are the residual gaps.

These findings are **not yet implemented** — they are recorded for a follow-up
hardening batch and its own acceptance criteria. Severities reflect the fully
traced reachable path after compensating controls.

### Evidence matrix (second pass)

| # | Candidate | Entry point / caller | Attacker capability & asset | Full path & existing controls | Reachability | Disposition |
|---|---|---|---|---|---|---|
| S1 | Object-scope not enforced on `List*` / `Dispatch*` | Authenticated user holding `List{Actions,ActionSets,Definitions,CompliancePolicies}` or `Dispatch*` **plus** a device/user-group-scoped grant | Scope-restricted admin reads (and executes) the entire org action catalog; asset is `ShellParams` script bodies + `FileParams` contents + "the org's complete security posture" (ADR 0024) | `Get*`/`Search`/`Add*`/mutate all call `enforceObjectReadScope`/`ObjectScopeListFilter`; the four `List*` handlers read the projection with no scope field, and `Dispatch{Action,ActionSet,Definition,ToGroup}` enforce **device** scope but never object read-scope. ADR 0024:88 explicitly promises "lists/reads/mutations are confined to their scope" | Production, any scoped operator | **HIGH — ✅ SHIPPED** (server PR #532, `f6240d4`): `Dispatch*` enforce object read-scope; `List*` scoped via the search index `@scope_group_ids` (fail-closed) + hydrate; behavioral valkey-search tests + a self-discovering coverage guard |
| S2 | OIDC auto-link-by-email lacks the SCIM takeover guard | SSO callback with `provider.AutoLinkByEmail=true` | Over-trusted/self-service/compromised IdP asserting `email_verified` seizes a pre-existing local **password** account (e.g. admin) via email match; asset is local-credential account integrity | `idp/linker.go` Step 2 links to any `GetUserByEmail` hit with no `HasPassword`/`TrustEmailAssertions` check; SCIM's `users_create.go:113` (WS5 #2) has exactly this guard. `email_verified` is asserted by the same IdP being defended against | Production when auto-link enabled | **✅ SHIPPED (server#534)** — mirrored the SCIM guard |
| S3 | `GetSSOLoginURL` unthrottled + `auth_states` never swept | Unauthenticated client that knows a provider slug | Resource exhaustion: each call = DB write (`auth_states`) + AES-GCM decrypt + outbound OIDC discovery; asset is control DB/disk + outbound-request reputation | The public endpoint is absent from the rate-limit ladder (which throttles Login/Refresh/Register/Logout/RenewCert/ListAuthMethods); `CleanupExpiredAuthStates` is defined but never scheduled, so rows are swept only on successful `Consume` | Production with ≥1 IdP | **✅ SHIPPED (#534)** — per-IP limiter + hourly auth_states sweep |
| S4 | Blind SSRF via IdP discovery/token URLs | Insider with `Create/UpdateIdentityProvider` (org-tier / narrow SSO-operator role) sets `issuer_url`; unauth `GetSSOLoginURL` triggers the fetch | Server issues a GET to an operator-set internal address (`169.254.169.254`, loopback, internal names); asset is internal-network reachability / port probing | `issuer_url` validates only `required,url` (no https-only, no private-range block); `newBoundedOIDCClient` has timeouts but **no `net.Dialer.Control`**. go-oidc issuer-match keeps it *blind* and the body is never returned | Production | **✅ SHIPPED (#534)** — dialer Control denylist (loopback/private/link-local/CGNAT/unspecified) |
| S5 | Inbox worker trusts a self-reported `action_id` with no assignment check | mTLS-bound agent's `ActionResult` on `control:inbox` | Compromised agent forges `ExecutionCreated`/`ExecutionCompleted`/`ComplianceResultUpdated` (self-reported `compliant`) for actions it was never assigned; asset is compliance/execution audit-record integrity | `handleExecutionResult` treats an unknown result ID as an action ID, looks the action up for **existence only** (never "resolves to this device"). Device-origin binding confines writes to the reporting device's own streams (no cross-device) | Production | **✅ SHIPPED (#544)** — inbox gates agent-scheduled results on resolution.ResolveActionsForDevice (drop-with-WARN) |
| S6 | `OutputChunk` accumulation: unbounded read + unknown-ID accept | mTLS-bound agent output stream → `GetActionOutput` reader | Memory-DoS on control: unbounded chunk count per execution, all concatenated into memory on read; asset is control availability | Per-chunk 64 KiB cap exists, but no per-execution total cap; `LoadOutputChunks` has **no `LIMIT`** and `loadLiveOutput` builds two `strings.Builder`s over every chunk; `handleExecutionOutputChunk` appends to unknown execution IDs. Device-origin binding limits it to own-device executions | Production | **✅ SHIPPED (#547)** — read bounded by SQL LIMIT (loaded slice) + byte-budget in loadLiveOutput (concat), with truncation marker |
| S7 | Unbounded batch ID lists → asymmetric-work DoS | Authenticated caller of a batch RPC (`user_ids`/`device_ids`/`role_ids`; a scoped admin qualifies for group/dispatch) | One request drives O(N) synchronous DB round-trips / CA-signings / enqueues; asset is control CPU/DB | Repeated proto fields are `dive,ulid` (per-element format) but carry **no `max=`** count cap; `Dispatch*`/batch group-mutations are not in `isExpensiveProcedure`. 30s deadline + general per-user limiter bound one request but it is repeatable. Inconsistent with the codebase's own `max=64`/pagination bounds | Production (proto change → SDK) | **✅ SHIPPED — SDK power-manage-sdk#316** (max=256 on 8 request-side ID fields, enforced by existing Validate()); server regression test #548 draft pending the server SDK bump |
| S8 | `AppendEventWithVersion` skips the actor-required invariant | Any caller of the OCC append path (TOTP consume, LPS keypair) | An event written with an empty actor defeats audit attribution; asset is audit-trail integrity | `AppendEvent`/`AppendEvents` validate `actor_type`/`actor_id` via `prepareEvent`; `AppendEventWithVersion` does not, and the DB columns default `''`. Both current production callers pass a non-empty actor (latent) | Production, latent | **✅ SHIPPED (#536)** — AppendEventWithVersion routed through prepareEvent |
| S9 | PII sealer / `Encryptor` fail **open** when unwired | Any event-append path if boot wiring is skipped | Plaintext PII / secrets written to the **immutable** log (unerasable), silently; asset is PII/secret confidentiality at rest | `sealPII` returns the event unchanged when the sealer is nil (vs. `MintUserDEK`, which fails **closed**); nil `Encryptor` returns plaintext. Only `cmd/control` appends and wires both before first append; **no guard test / archtest** pins it | Latent (boot-wiring only) | **✅ SHIPPED (#536)** — sealPII fails closed on PII with no sealer |
| S10 | NotFound-vs-PermissionDenied existence oracle | Scope-restricted caller of load-then-scope-check RPCs (`GetExecution`, `CancelExecution`, `GetDeviceLogResult`, `UpdateUserGroup`, `DeleteUserGroup`, `RemoveUserFromGroup`) | Distinguishes existing-but-out-of-scope (`PermissionDenied`, and SCIM-managed status) from unknown (`NotFound`); asset is object-existence confidentiality | These scope-check **after** the lookup; `StartTerminal` and the device-group siblings scope-check the id **first** and leak nothing — an intra-repo inconsistency vs. the project's uniform-NotFound rule. IDs are ULIDs (not enumerable) | Production | **✅ SHIPPED** — #540 (3 user-group handlers: scope-check reordered before lookup; keeps PermissionDenied, closes existence + SCIM-status oracle) + #542 (`GetExecution`/`CancelExecution`/`GetDeviceLogResult`: these need the loaded row to scope-check, so a miss resolves to **uniform PermissionDenied** for a scoped caller — maintainer chose to keep the WS3 code, NOT NotFound; global callers keep NotFound) |
| S11 | `enc:v2` documentation drift | Operator/auditor reading the at-rest format comments | Misdirection during an incident: comments say secrets are stored `enc:v2`, but the real format is `enc:v1:` and `enc:v2` is a **retired format the decryptor rejects** | 6 comment sites (`api/audit_handler.go:135`, `api/lps_keypair.go:35,42,183`, `eventtypes/payloads/lps_keypair.go:14,26`) misdescribe the tag; the stored bytes are correct | Docs only | **✅ SHIPPED (#536)** — corrected `enc:v2`→`enc:v1` in 6 sites |
| S12 | `UpdateServerSettings` actor = `system` | Admin flipping `ssh_access_for_all` / `user_provisioning_enabled` | Non-repudiation: the fleet-wide toggle's top-level event is attributed to `system`, not the acting admin; asset is audit non-repudiation | On the documented `TestSystemActorCanary` allowlist (cascade events are legitimately `system`) — currently an accepted design decision, but the top-level toggle arguably should carry `userCtx.ID` | Production | **✅ SHIPPED (#536)** — top-level event attributed to the acting admin |
| S13 | Gateway-published internal URL dialed unvalidated | Control `GatewayService` admin fan-out reads `pm:gateway:internal:<id>` from shared Valkey | Valkey/gateway compromise publishes an arbitrary URL that control then dials (with its `control` mTLS cert); asset is terminal-session admin routing | Same root class as the first-batch **OPEN** "gateway writes arbitrary Traefik KV" finding — a trusted routing writer + Valkey ACL is the real fix | Production self-register | **Folds into the existing OPEN finding** (same ADR) |
| S14 | SCIM cross-provider email link of an SSO user | Holder of provider A's SCIM token `POST /Users` with another provider's user's email | A lower-trust provider claims ownership of a higher-trust provider's **passwordless** SSO user by email (the `HasPassword` guard only covers local-password accounts); asset is cross-IdP account ownership | `users_create.go:113` guard is `HasPassword`-only; per-provider tokens, rate limits, and `verifyProviderOwnership` bound the rest | Production multi-IdP | **Design decision** — extend the guard to already-linked-to-another-provider, or accept |

### Findings (fix targets)

**FINDING [HIGH] Object-scope enforcement is bypassed by `List*` and `Dispatch*` RPCs (ADR 0024 violation)**
File: `internal/api/action_crud.go:152` (`ListActions`), `internal/api/action_set_handler.go:123` (`ListActionSets`), `internal/api/definition_handler.go:121` (`ListDefinitions`), `internal/api/compliance_policy_handler.go:98` (`ListCompliancePolicies`), `internal/api/action_dispatch.go:98,487,522,559` (`Dispatch*`)
Detail: `Get*`/`Search`/`Add*`/mutate all call `enforceObjectReadScope`/`ObjectScopeListFilter`; the four `List*` handlers and the `Dispatch*` handlers do not. A device/user-group-scoped admin who is blocked by `GetAction(outOfScopeId)→NotFound` can `ListActions` and receive that action with its full `ShellParams` script + `FileParams` contents, and can `DispatchAction` it onto an in-scope device — directly contradicting ADR 0024:88 ("a scoped admin's object lists/reads/mutations are confined to their scope").
Fix: push `ObjectScopeListFilter`-derived group filtering into the four `List*` store queries (mirror `search_handler.go:60`); add `enforceObjectReadScope` at each `Dispatch*` entry (fan-outs check the set/definition once); extend the self-discovering Get/Search parity test to cover `List*` and `Dispatch*` so it can't regress.

**FINDING [MED] OIDC auto-link-by-email lacks the account-takeover guard SCIM enforces**
File: `internal/idp/linker.go:158-193`
Detail: Step 2 links an IdP-asserted (`email_verified`) email to any existing user — including a local password admin — with no `HasPassword`/`TrustEmailAssertions` check; `TrustEmailAssertions`/`HasPassword` are never read in `internal/idp/`. SCIM's `users_create.go:113` (WS5 #2) refuses exactly this. The `email_verified` gate is asserted by the same (self-service/compromised) IdP being defended against.
Fix: before linking an asserted email to a pre-existing account, refuse (or require `provider.TrustEmailAssertions`) when the target `user.HasPassword` is true.

**FINDING [MED] `GetSSOLoginURL` is public but unthrottled, and expired `auth_states` are never garbage-collected**
File: `internal/auth/interceptor.go:35` (public, no ladder entry), `internal/api/sso_handler.go:169-220` (DB write + decrypt + outbound discovery per call), `internal/store/queries/auth_states.sql:10` (`CleanupExpiredAuthStates` — never invoked; `cmd/control/main.go` schedules only revocation + osquery sweeps)
Fix: add a per-IP limiter for `GetSSOLoginURL` in the interceptor and schedule `CleanupExpiredAuthStates` via `runPeriodic` alongside the other sweeps.

**FINDING [MED] Blind SSRF: OIDC discovery/token fetch has no private-range denylist**
File: `internal/idp/oidc.go:41-50` (`newBoundedOIDCClient` — plain `net.Dialer`, no `Control`), `internal/api/sso_handler.go:232` (public trigger); `issuer_url` validated only `required,url`
Fix: add a `net.Dialer.Control` (or resolved-IP check) rejecting loopback/private/link-local/ULA/metadata targets; constrain IdP URLs to `https` at the validation boundary.

**FINDING [MED] Inbox worker records execution/compliance for an unassigned, self-reported `action_id`**
File: `internal/control/inbox_worker.go:264-320` (agent-scheduled branch; action looked up for existence only at `:305`), `:430-465` (compliance emit trusting `result.Compliant`)
Fix: before minting `ExecutionCreated`/compliance events from the agent-scheduled path, verify the action currently resolves to the reporting device (reuse the resolution engine); drop with a WARN otherwise.

**FINDING [MED] Unbounded execution-output accumulation → control memory-DoS**
File: `internal/store/queries/events.sql:73` (`LoadOutputChunks` — no `LIMIT`), `internal/api/action_handler.go:235-268` (`loadLiveOutput` concatenates all chunks), `internal/control/inbox_worker.go:509-534` (appends to unknown execution IDs; no per-execution total cap)
Fix: cap cumulative output per execution at append time (drop/aggregate past a byte budget); `LIMIT`+paginate `LoadOutputChunks` with a total-bytes stop; for a genuinely-unknown execution, bound the accept window or hold in a device-scoped stream.

**FINDING [MED] Batch ID fields have no count cap (asymmetric-work DoS)**
File (proto, SDK): `sdk/proto/pm/v1/control.proto:280,511,1244,2003,2142,2162` (`user_ids`/`device_ids`/`role_ids`, `dive,ulid` with no `max=`); loops at `internal/api/action_dispatch.go:415-433`, `user_group_handler.go:429,600`, `device_group_handler.go:398`, `role_handler.go:312`
Fix: add `max=N` (e.g. `omitempty,max=256,dive,ulid`) to each repeated ID field plus a handler-level count guard; regen SDK types.

**FINDING [LOW-MED] `AppendEventWithVersion` does not validate the actor**
File: `internal/store/store.go:773-813` (no actor check; compare `prepareEvent` at `:671`)
Fix: validate `actor_type`/`actor_id` on this path too (ideally route through `prepareEvent`, which already duplicates seal+marshal). Latent — both callers pass actors today.

**FINDING [LOW] PII sealer / `Encryptor` fail open when unwired**
File: `internal/store/store.go:212-215` (`sealPII` nil → event unchanged, vs. `MintUserDEK:200` fail-closed), `internal/crypto/crypto.go:104-106,131-133` (nil `Encryptor` → plaintext)
Fix: make `sealPII` fail closed when a payload has `pii` fields but no sealer is wired, and/or add a self-discovering boot/archtest asserting the production store always wires a sealer + encryptor (mirroring the mandatory KEK check).

**FINDING [LOW] Existence oracle on load-then-scope-check handlers**
File: `internal/api/action_dispatch.go:654-661,962-969`, `internal/api/logs_handler.go:155-162`, `internal/api/user_group_handler.go:215,323,487`
Fix: scope-check the request id before the lookup (as `StartTerminal` and the device-group siblings do), else map the post-lookup out-of-scope result to NotFound.
Status: **✅ SHIPPED** — the three user-group handlers (`UpdateUserGroup`/`DeleteUserGroup`/`RemoveUserFromGroup`) via #540: scope check reads grants from the auth context, reordered ahead of the lookup, so out-of-scope ids (existing or not) are denied uniformly with PermissionDenied (no code change). The three execution/log handlers via #542: they need the loaded row to know the device, so a miss resolves through `deviceScopeMissError` to a PermissionDenied byte-identical to the out-of-scope path for a scope-restricted caller (global callers keep NotFound). **Maintainer decision (2026-07-12): keep the WS3 PermissionDenied code, not NotFound.**

**FINDING [INFO] `enc:v2` at-rest-format comments are stale (real format is `enc:v1:`)**
File: `internal/api/audit_handler.go:135`, `internal/api/lps_keypair.go:35,42,183`, `internal/eventtypes/payloads/lps_keypair.go:14,26`
Fix: `s/enc:v2/enc:v1:/` (the decryptor *rejects* `enc:v2`), and docref-anchor the comments to the `crypto.prefix` constant.

**FINDING [LOW] `UpdateServerSettings` audit event is attributed to `system`, not the acting admin**
File: `internal/api/settings_handler.go:82-83`
Fix (reconsider): carry `userCtx.ID` on the top-level `ServerSettingUpdated` event (leave the cascade system-action events as `system`); update the `TestSystemActorCanary` allowlist rationale accordingly.

### S1 remediation — scoped `List*`/`Dispatch*` + authorization-coverage guards

> **✅ SHIPPED** — server PR #532 (`f6240d4`), issue #531. The production fix and
> the object-scope behavioral coverage guard below are implemented; the broader
> AST-driven permission-coverage system (permission-coverage guard + every
> read/write/delete path) is carried forward to **spec 30**. The rest of this
> spec's findings (the first-batch 5 items and S2–S14) remain open — this spec
> stays `draft` until they are addressed.

S1 exists because the two self-discovering scope guards each have a structural
blind spot that the object read handlers fall through:

- `TestScopablePermissions_AllEnforced` guards the **permission-TargetKind** axis;
  its `recognizedScopeFns` set does not include the object-scope enforcers.
- `TestObjectScope_EnforcementMatchesIndexFiltering` guards the **object** axis
  but only at the **type** level — it asserts `enforceObjectReadScope("action")`
  appears *somewhere* (satisfied by `GetAction`), and that Search's index carries
  `scope_group_ids`. It models exactly two read surfaces, **Get** and **Search**;
  `List*` is a third read surface (reads the projection directly, returns full
  `ShellParams`/`FileParams`) that was never in the model, and `Dispatch*` reads
  the object with only device-scope. Neither guard is behavioral, so a handler
  that reads the projection but skips the filter passes.

Remediation has three parts — the production fix plus two guards that make the
whole class self-discovering and behavioral so a future handler cannot regress it.

**Production fix.**
- `List{Actions,ActionSets,Definitions,CompliancePolicies}` and their `Count`
  siblings gain a `@scope_restricted`/`@scope_group_ids` SQL filter (mirroring the
  device/user list queries): for a restricted caller, an object is listed only
  when it has an assignment whose target group is in the caller's scope (a device/
  user target resolves through group membership). This is **direct-assignment**
  scope — a conservative subset of `GetAction`'s *effective* (container-walk)
  visibility: it never over-shows (the leak is closed) and is pagination/
  `TotalCount`-correct. It may under-show an object visible only transitively via
  a containing set/definition; extending List to effective visibility to fully
  mirror Get is a noted follow-up, not a leak.
- `DispatchAction`/`DispatchActionSet`/`DispatchDefinition`/`DispatchToGroup` call
  `enforceObjectReadScope` on the referenced object id before dispatch (in
  addition to the existing device-scope), matching the `AddActionToSet` /
  `AddActionSetToDefinition` / `AddActionToPolicy` guard so a scoped admin cannot
  execute an object it cannot read.

**Guard 1 — object-scope behavioral coverage (self-discovering, runtime).**
A runtime reflection sweep (same shape as `TestEveryControlRPCRunsValidateBeforeWork`)
enumerates every `ControlService` RPC whose name identifies an operation on a
scopable object type (`List*`/`Get*`/`Dispatch*`/mutations on
`action`/`action_set`/`definition`/`compliance_policy`, derived from the
`objectTypeToIndexScope` registry). Each such RPC is driven with a
scope-restricted caller and a seeded **out-of-scope** object, and must confine it
(list omits it / Get → NotFound / dispatch → NotFound). A completeness self-check
asserts every discovered object RPC is present in the coverage table with a
matches-zero guard and a no-orphan guard, so a newly added object RPC fails the
build until it is both enforced and covered. Behavioral, not presence-based — the
exact gap that let S1 through.

**Guard 2 — permission-coverage (self-discovering).**
A sweep asserts every `ControlService` RPC is either in the reviewed
`PublicProcedures` allow-list or resolves to a valid, interceptor-enforced
permission key; a companion check asserts every `PublicProcedures` entry names a
live RPC (no stale exemption silently widening the unauthenticated surface).

### Acceptance criteria (S1 remediation)

- **AC-S1.1** Given a scope-restricted caller and an object assigned only outside
  their scope, when they call `ListActions`/`ListActionSets`/`ListDefinitions`/
  `ListCompliancePolicies`, then the object is absent and `TotalCount` equals the
  returned count; a global caller sees it.
- **AC-S1.2** Given a scope-restricted caller and an out-of-scope object, when they
  call `DispatchAction`/`DispatchActionSet`/`DispatchDefinition`/`DispatchToGroup`
  referencing it, then the call fails `NotFound` before any dispatch, even onto an
  in-scope device.
- **AC-S1.3** Given the object-scope behavioral guard, when a `ControlService`
  object RPC is added without scope enforcement, then the guard fails; when an
  object RPC exists that the coverage table omits, the completeness check fails
  (matches-zero and no-orphan guards hold).
- **AC-S1.4** Given the permission-coverage guard, when a `ControlService` RPC is
  neither public-allow-listed nor bound to an enforced permission, then it fails;
  every `PublicProcedures` entry names a live RPC.

## Acceptance criteria

1. Given a configured task signer and a known queue class, when a task is wrapped and verified with the same direction, exact queue, task type, and payload, then verification returns the original payload.
2. Given a valid signed task, when its envelope version, direction, queue, task type, payload, or signature is changed independently, then verification rejects it before the task handler runs.
3. Given an unknown queue class, when a signed task is enqueued or verified, then the operation fails closed and no task handler runs.
4. Given an old payload-only HMAC envelope, when a hardened worker receives it, then it is rejected as unsigned/unsupported rather than accepted through a compatibility fallback.
5. Given an untrusted direct peer with XFF or X-Real-IP headers, when the interceptor's `clientIP` resolves the limiter key, then the direct peer remains the key.
6. Given a trusted direct peer and an XFF chain containing attacker-supplied left entries followed by the observed client and zero or more trusted proxies, when `clientIP` resolves, then the first non-trusted address found from right to left is returned.
7. Given a trusted direct peer and a malformed forwarded chain before a trustworthy client can be established, when `clientIP` resolves, then resolution falls back to the direct peer instead of trusting a farther-left value.
8. Given a gateway control URL with HTTPS and a host and without user-info, query, or fragment, when configuration is validated, then startup accepts it and logs only `scheme://host[:port]`.
9. Given a gateway control URL that is empty, malformed, non-HTTPS, hostless, or contains user-info, query, or fragment, when configuration is validated, then startup rejects it without logging the raw value.
10. Given a decoded JSON object whose stream/event has no redaction schema and whose nested key matches `password`, `passphrase`, `psk`, `private_key*`, `*_secret`, `*_hash`, `*_encrypted`, or `*_enc` case-insensitively, when audit data is rendered, then every matching value is replaced with `[REDACTED]`. The deny rules are derived from the codebase's **actual** secret-field naming — the existing schema paths scrub `client_secret_encrypted`, `secret_encrypted`, `scim_token_hash`, `password_hash`, `backup_codes_hash`, `private_key_enc`, `password`, and `passphrase` — so `*_encrypted` / `*_enc` are included specifically to catch the ciphertext-suffix fields (`client_secret_encrypted`, `secret_encrypted`) that a `*_secret`/`*_hash`-only set would silently miss.
11. Given an unknown-schema decoded object with no matching secret key, when audit data is rendered, then its original bytes are returned unchanged.
12. Given malformed JSON, a non-object payload, or an event with an existing schema, when audit data is rendered, then existing behavior remains unchanged and the fallback does not replace schema-aware redaction.
13. Given the reference Compose deployment, when its effective configuration is inspected, then only the Docker socket proxy mounts `/var/run/docker.sock`, Traefik uses the proxy endpoint, mutation methods remain disabled, and only container/event API sections are explicitly enabled.
14. Given the Docker socket proxy and Traefik services, when Compose networking is inspected, then the proxy port is not published to the host and both services share a dedicated internal network not joined by application services.
15. Given all five changes, when the server verification gate runs, then vet, static analysis, the complete test suite, deployment checks, and docref all pass.

## Out of scope

- Transactional multi-event SCIM appends or SCIM event reordering.
- A trusted Traefik KV routing-writer service, per-gateway identity, or Valkey ACL migration; this requires a separate architectural decision because an extra credential held by the gateway does not isolate a compromised gateway. **This finding (gateway writes arbitrary Traefik routing keys) remains OPEN — it is deferred to its own ADR, not remediated by this spec.** A reader must not infer that all audited HIGH findings are closed by this batch: the routing-write surface is explicitly still open.
- Changes to the accepted device-to-gateway binding posture in ADR 0005.
- Runtime placeholder replacement for malformed or non-object audit payloads.
- Replacing schema-aware audit redaction; the key-name fallback runs only when schema lookup returns no schema.
- Request-ID and detached-context changes already tracked by the existing context/doc-truth pass.
- Test-only Docker module advisories and CI action pinning.
- Protobuf, database schema, event type, authorization, or public API changes.

## Technical design

### Affected packages

- `server/internal/taskqueue` — version and domain-separate signed task envelopes; bind direction, exact queue, and task type at enqueue and middleware verification.
- `server/internal/auth` — replace the leftmost-hop selection in the interceptor's `clientIP` with right-to-left trusted-proxy chain resolution. `clientIP` is the single client-IP resolver (all six rate limiters call it); there is no separate HTTP resolver to change or keep in sync.
- `server/internal/config` and `server/cmd/gateway` — validate the control URL at startup and derive a non-secret origin for logs and client construction.
- `server/internal/api` — recursively redact deny-set key names only for decoded object payloads without a selected schema.
- `server/deploy/compose.yml` — add an isolated Docker socket proxy and point Traefik's Docker provider at it.
- `server/internal/archtest` — structurally pin the Docker socket isolation and proxy allowlist.

### Task envelope

The task envelope is a clean-break v1 format:

- one version byte;
- a 32-byte HMAC-SHA256 signature;
- the original payload bytes.

The HMAC preimage uses a fixed task-signing domain tag plus unambiguous length-prefixed fields for version, direction, exact queue name, task type, and payload. Direction is derived from the known queue class (`device:*`, control inbox/terminal-audit, or search), so callers cannot assert an arbitrary direction independently. Verification uses `hmac.Equal`. Unknown queue classes, unsupported versions, short envelopes, and signature mismatches fail closed. There is no legacy payload-only fallback.

### Trusted proxy resolution

The change is confined to the interceptor's `clientIP` — the only client-IP resolver in the server; there is no separate `net/http` rate-limit path. If the direct peer is not trusted, forwarded headers are ignored. If it is trusted, XFF is walked from right to left: trusted proxy addresses are skipped and the first untrusted address is the client. A malformed hop causes fallback to the direct peer. X-Real-IP is considered only when XFF is absent. (If a future pure-HTTP endpoint ever needs IP attribution, it reuses this same function rather than reintroducing a parallel parser.)

### Control URL validation

Startup validation uses `net/url`. The accepted shape is HTTPS with a non-empty host and no user-info, query, or fragment. Existing path behavior remains accepted for Connect base URLs, but logs contain only the URL origin. Validation errors name the invalid component without echoing the configured URL.

### Unknown-schema audit fallback

After JSON successfully decodes into an object and schema lookup returns no schema, recursively walk maps and arrays. Match key names case-insensitively against the narrow deny rules in acceptance criterion 10 (`password`, `passphrase`, `psk`, `private_key*`, `*_secret`, `*_hash`, `*_encrypted`, `*_enc`) — a set derived from the actual secret-field names the existing schema paths scrub, not a generic guess, so it covers the codebase's `_encrypted`/`_enc` ciphertext suffixes. Re-marshal only when a value was replaced; otherwise return the original bytes. Known schemas continue through the existing exact-path redactor. Invalid JSON and non-object JSON continue unchanged.

### Docker API proxy

Add `ghcr.io/tecnativa/docker-socket-proxy` pinned by immutable image digest. It alone bind-mounts the Docker socket. Explicit proxy policy enables `CONTAINERS=1` and `EVENTS=1`, keeps `POST=0`, and relies only on the proxy's default ping/version read endpoints beyond those sections. Traefik sets its Docker provider endpoint to the proxy's internal TCP address. The proxy has no host-published port and shares a dedicated internal Compose network only with Traefik.

### Proto changes

None.

### Database changes

None.

### New dependencies

- Docker socket proxy container image: required because Traefik's Docker provider needs Docker API reads, while Compose and Docker do not provide per-method Unix-socket ACLs. The proxy is the approved, standard deployment boundary and adds no Go dependency. Its image must be pinned by digest.

## Security considerations

- Authorization: unchanged. Existing device-origin binding remains enforced before inbox event appends.
- Input validation: queue metadata, forwarded chains, URL components, and decoded audit object shapes fail closed as specified.
- Secrets: raw URLs are never logged; unknown object secret-looking values are replaced before audit responses; task payloads are never included in verification errors.
- Crypto: HMAC-SHA256 and constant-time comparison remain standard-library operations; the preimage gains an explicit domain tag and unambiguous metadata binding.
- Audit: no new state-changing operation is introduced.
- Deployment: the Docker API proxy is isolated from application services and exposes no host port.

## Test requirements

### Taskqueue tests

- Update signer round-trip tests to supply known queue/type metadata.
- Add independent version, direction/queue-class, exact-queue, type, payload, signature, unknown-queue, truncated, wrong-key, and legacy-envelope rejection tests.
- Update real client/miniredis tests to verify the stored task only under its actual queue and type.
- Drive real Asynq middleware and assert a queue/type replay never invokes the downstream handler.

### Trusted-proxy tests

- Extend the existing `interceptor_test.go` client-IP attribution table with one proxy, multiple trusted proxies, spoofed left entries, malformed right-side entries, absent XFF with X-Real-IP, untrusted direct peers, IPv4, and IPv6.
- No second parsing path is tested: `clientIP` on the Connect interceptor is the sole consumer, so there is no separate HTTP resolver to cover.

### Gateway configuration tests

- Add accepted HTTPS URL cases and rejection cases for empty, malformed, HTTP, hostless, user-info, query, and fragment.
- Assert the derived log value contains only scheme and host/port and never path or rejected components.

### Audit-redaction tests

- Replace the unknown-secret pass-through expectation with nested object/array deny-set cases, including the ciphertext-suffix fields (`client_secret_encrypted`, `secret_encrypted`) that motivated the `*_encrypted` / `*_enc` rules — a `*_secret`/`*_hash`-only set must be shown to miss them.
- Preserve byte-equality tests for unknown non-secret objects, malformed JSON, non-object JSON, and known schema behavior.
- Source deny-set fixtures from the stated security intent (the codebase's real secret-field inventory), not from the implementation's matcher.

### Deployment tests

- Add a self-discovering architecture test over the tracked Compose file that asserts exactly one Docker socket mount, that it belongs to the proxy service, that Traefik uses the proxy endpoint, that POST is disabled, that only required sections are enabled, and that the proxy network/port exposure is isolated.
- Run `docker compose config` when Docker Compose is available in the verification environment; the architecture test remains the always-runnable regression check.

### Acceptance-criterion mapping

| Criteria | Automated tests |
|---|---|
| 1–4 | Task signer, client, and real middleware tests |
| 5–7 | Interceptor `clientIP` attribution tests |
| 8–9 | Gateway config validation and sanitized-origin tests |
| 10–12 | Audit redactor internal tests |
| 13–14 | Compose architecture test; optional `docker compose config` verification |
| 15 | Full verification gate |

## Rejection paths

| Scenario | Error code / process result | Client-visible message | Logged context |
|---|---|---|---|
| Unsupported/legacy task envelope | `asynq.SkipRetry` | None; task is dead-lettered | Queue, task type, typed verification error; never payload |
| Signed task replayed under another queue/type | `asynq.SkipRetry` | None; handler is not invoked | Queue, task type, signature mismatch |
| Producer uses unknown queue class | Enqueue error; no task stored | Calling operation receives specific enqueue error | Existing caller operation context; never payload |
| Untrusted peer supplies forwarded headers | Request continues using direct peer limiter key | No new client error | Existing rate-limit log fields if the limit is reached |
| Trusted proxy supplies malformed XFF | Request continues using direct peer limiter key | No new client error | Existing rate-limit log fields if the limit is reached |
| Gateway control URL has forbidden component | Gateway startup exits non-zero | Startup configuration error | Invalid component name only; raw URL omitted |
| Unknown audit event contains deny-set key | Request succeeds with redacted JSON | `[REDACTED]` at matching values | No secret-bearing log field |
| Docker proxy receives a mutation request | HTTP 403 from proxy | Traefik provider operation fails | Proxy/Traefik operational logs without Docker credentials |

## Rollout and migration

1. Drain pending Asynq queues or stop producers before deploying the task-envelope change.
2. Deploy control, gateway, and indexer from the same release; mixed old/new task signers are intentionally unsupported.
3. Deploy the socket proxy and Traefik endpoint change together. Do not expose the proxy port outside its dedicated internal network.
4. No database or protobuf migration is required.

## References

- ADR 0005: Gateway↔control device-origin binding.
- `https://github.com/Tecnativa/docker-socket-proxy` — proxy policy and isolation recommendations.
- Traefik Docker provider documentation: `https://doc.traefik.io/traefik/providers/docker/`.
