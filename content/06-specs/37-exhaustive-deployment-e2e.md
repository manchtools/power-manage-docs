---
title: "Exhaustive deployment E2E gate"
status: draft
created: 2026-07-16
---

# Exhaustive deployment E2E gate

## Overview

Supersede health-based and hand-picked deployment probes **as the release gate**
with a self-discovering, generated-client E2E contract suite that boots the real
current-commit images from the real Compose artifacts and exercises every
deployed Power Manage RPC, stream message arm, listener/authentication plane,
and critical cross-service state machine before a release can publish version
tags or manifests. This is additive, not a replacement: the existing smoke test
is retained as a fast infrastructure preflight that runs beneath this suite.
Release provenance and publication authority (the reviewed change-set manifest,
single-build attestation, digest ledger, tag/alias promotion) are specified
separately in spec 39; this suite is the deployed-execution gate that spec 39's
publication authority requires to be green.

## Motivation

Alpha3 reached healthy container status while real features remained broken: Valkey TLS key permissions, Pub/Sub ACLs, Search RPC prefix permissions, and bootstrap entities missing from search. Synthetic testcontainers proved primitives but not deploy artifacts; passive health/log scans only surfaced paths that happened to run; a hand-picked `FT.SEARCH` probe initially passed against an empty index. The release gate needs a completeness invariant tied to the generated protocol surface, not an expanding list of known bugs.

## Acceptance criteria

1. Given generated Power Manage descriptors, when the offline E2E registry test
   runs, then every canonical Connect procedure key (`"/" + service.FullName() +
   "/" + method.Name()`, for example `/pm.v1.ControlService/Login`) is classified
   exactly once. Physical listener, intended ingress, accepted peer identity, and
   mount state are separate fields rather than mutually exclusive plane names;
   zero matches, duplicates, stale entries, and unclassified procedures fail CI.
2. Given the current protocol surface, when the exact-set guard runs, then every
   discovered procedure, mounted or explicitly unmounted, pins a method-contract
   fingerprint over streaming flags and complete recursively normalized input and
   output descriptors plus a named payload-contract version. Every mounted method
   has typed credential/peer-trust scenarios and method-specific outcomes. Every
   explicitly unmounted method instead has an intentional-exclusion rationale and
   typed non-exposure assertions against every production listener; a procedure
   reachable anywhere cannot be classified unmounted. Both `DeviceAuthService`
   methods have registered Unix-socket scenarios; counts are diagnostic only and
   exact equality is authoritative.
3. Given every client-streaming, server-streaming, or bidirectional method, when
   the exact-set guard runs, then its method-contract fingerprint covers all
   top-level envelope fields inside and outside oneofs. Every oneof arm in either
   direction additionally has a disjoint direction-qualified child key, typed
   scenario, named payload contract, and fingerprint covering the outer field plus
   recursively referenced messages/enums. Streaming envelopes without oneofs still
   require the complete method contract. Adding a streaming method/arm or changing
   streaming shape, an envelope field, arm field, or recursive payload fails CI.
4. Given a protected Control RPC, when its deployed contract scenario runs with a
   per-method authentication-safe fixture, then an anonymous request returns
   `Unauthenticated`, a zero-permission user returns `PermissionDenied`, and a
   domain-safe typed request reaches its method-specific outcome. When the typed
   request contract admits an invalid generated value, an admin malformed request
   additionally returns `InvalidArgument`; otherwise the registry declares
   `malformed-admin: not-applicable`, verified against descriptors and generated
   validation metadata.
5. Given the canonical pre-JWT procedure set, when the exact-set scenario guard
   runs, then the set is the exact union of true entries in
   `auth.PublicProcedures` and separately mounted self-authenticating public
   procedures such as `/pm.v1.GatewayAuthService/EnrollGateway`; each entry records
   its mount/auth source and is classified exactly once as credential-bearing or
   intentionally credentialless. Credential-bearing procedures exercise a
   schema-valid incorrect credential and assert the deployed non-authorizing
   outcome, then succeed with the correct production mechanism, including
   replay/rotation where applicable. Rejection is the default, but named contracts
   may deliberately return success only while proving no protected-state effect;
   `Logout` is credential-bearing and idempotent in exactly that way.
   Credentialless procedures (including `ListAuthMethods`) prove anonymous
   method-specific behavior and deployed rate limiting. Generated validation is
   required only when the request has a violable constraint; zero-field or
   constraint-free requests declare `validation-not-applicable` rather than
   inventing malformed typed input.
6. Given an internal mTLS RPC, when its scenario runs, then no certificate and
   every wrong peer class are rejected and the correct peer class reaches domain
   behavior. Wrong-listener non-exposure is required only where production has
   distinct listeners/muxes. `AgentService` and `GatewayService` both record
   `listener=gateway-mtls`; their public-Traefik versus internal-registry ingress
   and agent/device versus control peer identities distinguish them.
7. Given a fresh Compose stack, when E2E fixtures initialize, then bootstrap-admin login succeeds and Search returns the bootstrap user without a manual rebuild.
8. Given real indexed state, when Search and RebuildSearchIndex scenarios run, then convergence is polled, exact entities are returned, rebuild preserves expected contents, and unrelated Valkey keys/dangerous commands remain denied.
9. Given a generated-client protocol agent, when dispatch, inventory, OSQuery, logs, compliance, LUKS/LPS, and terminal flows run, then it verifies production signatures/sealing before responding and the corresponding RPCs reach their expected final state.
10. Given terminal E2E, when StartTerminal succeeds, then a real WebSocket client presents the bearer subprotocol, completes STARTED, drives input/resize/stop through the agent stream, and proves GatewayService list/terminate fan-out through control.
11. Given SSO E2E, when the full OIDC flow runs, then production discovery, PKCE, nonce/state, token exchange, JWKS verification, identity creation/linking, and replay rejection are exercised without disabling SSRF protection.
12. Given SCIM E2E, when discovery and authenticated user/group operations run through the deployed HTTP handler, then responses and persisted state match SCIM behavior.
13. Given agent-local E2E, when the real agent daemon exposes `/run/pm-agent/enroll.sock`, then both `DeviceAuthService` RPCs are exercised through the Unix socket for initial enrollment, failed-initial-enrollment retry, already-enrolled refusal, and corrupt/non-absent credential-state refusal without replacement. Root-only offline reenrollment is never exercised through the mode-`0666` socket; spec 38 owns its separate CLI/filesystem lane.
14. Given public E2E calls, then Control uses production-shaped Traefik TLS termination and Gateway uses Traefik TCP passthrough/dynamic Redis routes; direct internal listeners are used only for internal-plane trust probes.
15. Given a browser-compatible preflight, credentialless `ListAuthMethods`, and a
    protected generated Connect JSON request with a real login-issued JWT from
    `https://app.power-manage.manchtools.com`, then Traefik/control return the
    exact method-appropriate CORS header sets and usable responses expected by the
    hosted web app; unlisted and suffix-near-match origins receive no browser grant.
16. Given certificate renewal/revocation and an old certificate that remains TLS-valid for the proof window, when the credential is superseded while the entity remains active, then fresh connections complete TLS and receive the exact Gateway CRL-middleware HTTP 403/log before Connect handling. One production-shaped public probe plus per-replica internal trust probes prove every Gateway cache; later handler failures and TLS time/chain errors do not count. The renewed certificate succeeds.
17. Given any run of this suite (PR candidate or release rerun), when the stack
    is built, then every binary and image derives from the reviewed immutable
    `sdk_sha` / `server_sha` / `agent_sha` change-set manifest defined in spec
    39; the E2E startup ledger records those exact identities, and a run whose
    stack was built from an ambient branch head, matching tag, or published
    default image fails before any scenario executes.
18. *(Split 2026-07-18.)* Reviewed change-set manifest structure, single-build
    binary/image provenance, digest-ledger publication authority, draft-Release
    ordering, and floating-alias promotion/rollback are specified in spec 39.
    This suite is spec 39's consumer and precondition: publication requires a
    green run of this suite — including the AC 23 execution-completeness guard —
    against the exact captured digests.
19. Given an E2E failure, then CI uploads complete redacted Compose state, health/restart counts, service logs, scenario ledger, and JUnit output before teardown; secrets, `.env`, private keys, tokens, and raw secret-bearing payloads are never uploaded.
20. Given intentional negative probes, when the final post-suite health/log gate
    runs, then every negative probe carries a unique run-scoped correlator
    (certificate CN, header, request ID, or source tuple) recorded in the
    scenario ledger, and every expected rejection log line is matched **1:1** to
    exactly one probe correlator. Any panic/fatal/internal/ACL/`NOPERM`/TLS/
    bad-certificate line matched to zero probes — or to more than one — fails
    the gate, as do unhealthy containers and unexpected restarts, so a real
    regression cannot be laundered through the negative-probe exception.
21. Given the real-agent lane registry, then its stable exact keys are
    `agent-socket`, `agent-signed-sync`, and `agent-reenrollment` with no aliases or
    placeholders. Descriptor presence of either `DeviceAuthService` method
    activates `agent-socket`, so its complete baseline lands atomically with the
    registry. Registration of `signed-manifest-v1` declares
    `agent-signed-sync` ready; registration by the agent artifact of
    `offline-reenrollment-v1` declares `agent-reenrollment` ready. Capability
    readiness and per-change lane selection are distinct: canonical path selectors
    force an already-ready lane to run but never create readiness. Once ready, a
    lane is a mandatory release dependency for every compatible candidate; missing,
    duplicate, stale, or activated-but-skipped lanes fail CI. The scenario ledger
    records both the readiness capability and the selector/release dependency that
    caused the current run.
22. Given a method-contract or stream-arm fingerprint differs from the merge-base,
    when offline exactness runs, then CI also requires both the associated named
    payload-contract version and the typed scenario-source fingerprint to differ
    from that merge-base. Replacing only the expected descriptor fingerprint, or
    changing a scenario comment/format without changing its typed contract source,
    fails review enforcement.
23. Given a completed deployed run, when the post-suite execution-completeness
    guard evaluates the scenario ledger, then the set of mounted procedures with
    a recorded real-assertion pass equals the registered mounted set (exact
    equality). A registered scenario that early-returned, skipped, was filtered
    by a selector, or was dropped for budget reasons counts as missing; any
    missing procedure, any duplicate ledger claim, and a zero-entry ledger fail
    CI. The guard is budget-independent: no runtime budget, retry policy, or
    lane selector may exempt a mounted procedure from deployed execution.
24. Given the booted stack, when reflection reconciliation runs before
    scenarios, then each deployed server's served-procedure set (gRPC/Connect
    reflection where mounted, otherwise the canonical production route catalog)
    is enumerated and its union is compared against the offline discovered
    registry; any served procedure absent from the registry fails CI. This
    closes the import-graph gap: `protoregistry.GlobalFiles` contains only
    linked-in generated packages, so a served-but-unimported service must be
    caught here — the offline matches-zero guard cannot see it.
25. Given each object family with owner/scope semantics (discovered from the
    permission/object-family registry with a matches-zero guard, never a
    hardcoded list), when a deployed out-of-scope probe runs with a real
    scope-limited JWT against an existing object outside that scope, then the
    response is `NotFound` — never `PermissionDenied` and never object data.
    At least one such probe per object family is mandatory; a family without a
    registered probe fails the exactness guard. Handler tests bypass the
    deployed interceptor chain, so this existence-oracle property must be
    proven against the booted stack.
26. Given a typed semantic success scenario, when it records its pass, then its
    ledger entry includes at least one method-specific effect assertion beyond
    a non-error status (returned field value, read-after-write, state delta, or
    convergence observation) plus the recorded assertion count; an entry with
    zero effect assertions does not count as a real-assertion pass for AC 23.
    "Returned OK" alone never satisfies typed-success, regardless of runtime
    budget pressure.
27. Given the TLS surfaces this suite deploys (Traefik termination, gateway TCP
    passthrough, internal mTLS listeners, per-replica CRL probes), when the
    stack boots, then mounted key/cert material reproduces production
    ownership, file modes (including root-owned `0600` private keys), and image
    UID drops, and every internal dial asserts both the dial address and the
    TLS verification identity; a world-readable test key, or an IP dial target
    verified against a DNS-only certificate, fails the run even when both
    endpoints are otherwise reachable.

## Out of scope

- Replacing existing real-handler correct/absent/malformed and fine-grained authorization tests. Deployed E2E complements them; it cannot prove every field/scope rule economically.
- Direct database writes, synthetic JWTs/auth contexts, handler instantiation, privileged CA/control private-key mounts, or direct Valkey business-state seeding.
- Treating one happy path and one generic rejection as semantic exhaustiveness for a complex RPC.
- Enabling a partial release gate with skipped/placeholding RPC entries. The release dependency activates only when exact coverage is complete.
- Release provenance and publication machinery — reviewed change-set manifest structure, single-build attestation, digest-ledger authority, tag/alias promotion and rollback. Split to spec 39 (2026-07-18); this suite consumes the recorded candidate identities (AC 17) and is spec 39's publication precondition.

## Technical design

### Affected packages and repositories

- `server/e2e/` — E2E registry, generated clients, fixtures, protocol actors, Compose integration, and scenario ledger.
- `server/deploy/` and `server/.github/workflows/` — real-stack execution, current-image builds, diagnostics, and release gating.
- `agent/` — real-daemon Unix-socket lane for initial enrollment and fail-closed non-replacement states. Spec 38 supplies the separate root-only reenrollment CLI/filesystem lane.
- `sdk/` — consumed generated descriptors, clients, and production verification helpers.
- `docs/` — this spec and operator/testing documentation.

### Proto changes

None initially. The suite consumes generated descriptors and clients without adding
a testing-only RPC or message. Any future production proto change remains
independently specified and must alter at least one authoritative exactness
artifact: the discovered procedure/arm key set, a method-contract fingerprint over
streaming shape plus complete input/output descriptors, or an additional stream-arm
fingerprint. The guard fails until the named deployed payload contract is reviewed
and updated.

### Database changes

None. E2E fixtures create and inspect business state only through deployed APIs; they do not add test tables or write projections directly.

### New dependencies

None initially. Reuse the generated Connect clients, Go standard-library HTTP/TLS test servers, the existing `github.com/coder/websocket` dependency, and the current Compose/Docker tooling. A new dependency requires a concrete missing capability and separate justification.

### Offline exactness registry

Create `server/e2e/rpc/` as a static Go test package. Discover Power Manage
services from `protoregistry.GlobalFiles`; do not hardcode proto filenames. The
canonical key is the generated Connect procedure form `"/" + service.FullName() +
"/" + method.Name()`. Descriptor names, generated constants, mount catalogs, and
JWT-bypass keys normalize to that exact form before equality checks. Stream arms
use disjoint child keys (`<procedure>#client:<oneof>:<arm>` and
`<procedure>#server:<oneof>:<arm>`), so procedure classification and arm coverage
cannot mask each other.

Each procedure entry declares:

- physical listener, intended ingress, accepted peer identity, and mount state;
- its production mount/auth source, including the separate self-authenticating
  `GatewayAuthService` mount rather than adding it to `auth.PublicProcedures`;
- every required credential or peer-trust class and expected outcome;
- a deterministic method-contract fingerprint over client/server streaming flags
  and recursively normalized complete input/output descriptors, plus a
  human-readable payload-contract key such as `signed-manifest-v1`;
- an authentication-safe request factory that passes every non-auth validation gate;
- either a malformed request factory or a descriptor-verified
  `malformed-admin: not-applicable` / `validation-not-applicable` declaration;
- stateful/side-effect ordering policy;
- typed semantic success scenarios; or, for an explicitly unmounted method, an
  exclusion rationale plus non-exposure checks for every production listener.

Every streaming method is discovered from its method descriptor, including
client-only/server-only streams and envelopes without oneofs. Each stream-arm
child additionally declares a named payload contract and a fingerprint over the
normalized outer field descriptor (number, proto/JSON name, cardinality, and type)
plus recursively referenced messages/enums. Arm fingerprints supplement rather
than replace the method-contract fingerprint, which protects fields such as
`AgentMessage.id` and `ServerMessage.id` outside their oneofs. Fingerprints derive
from normalized descriptors, not generated file bytes. Source-level validation-tag
guards remain separate because `@gotags` comments are not runtime descriptor
authority. The registry also computes a deterministic fingerprint of each typed
scenario's contract source (request factory, credential/peer cases, expected
outcomes, side-effect assertions, and payload-contract binding), excluding comments
and formatting. CI reads the merge-base registry and enforces a three-part review
transition: any changed method/arm descriptor fingerprint requires both a changed
named payload-contract version and changed typed scenario-source fingerprint.
Updating only the expected descriptor hash, or touching only scenario comments,
fails. A scenario-only behavior change still requires its own review but does not
fabricate descriptor drift.

Non-protobuf HTTP, SCIM, health, and WebSocket endpoints use a separate exact registry discovered from one canonical production route catalog shared by route mounting and E2E; a duplicated test-only route list is forbidden. Every route key declares ingress, credential, and expected-outcome scenarios with the same zero-match, duplicate, stale, and missing guards.

Every reachable procedure registers typed success and rejection scenarios using generated procedure constants and clients. Reflection is allowed for discovery and exactness only, not for semantic successful calls.

### Deployed world

Public scenarios run from the CI host against only the mapped Traefik ports, with test DNS names resolving to the host. They are never attached to `pm-internal` and cannot resolve or dial control, gateway, Postgres, Valkey, or indexer service addresses directly.

Internal trust probes run in a separate short-lived actor attached only to `pm-internal`. It receives the smoke CA certificate and only its own API-issued peer identities; for a revocation scenario it may also receive that scenario's already-revoked public agent credential solely to probe each discovered Gateway replica directly with production SNI. It receives no public bootstrap password, `ca.key`, `control.key`, datastore key, or Valkey credential. The suite asserts that public procedures are exercised by the host runner and internal procedures by the internal actor, preventing a scenario from silently bypassing its required ingress.

All server business state is created and asserted through generated RPC clients. Fixtures use run-ULID names and scenario-owned cleanup. Long-lived protocol actors are shared only where the deployed state machine requires it. The `agent-signed-sync` lane may additionally capture agent-local SQLite scheduler state read-only after quiescing the process; it may never seed or mutate that database, and the capture is redacted as a diagnostic artifact.

### Contract sweep

For protected Control methods, run schema-valid unauthenticated, schema-valid
zero-permission, and domain-safe typed calls. Run malformed-admin only where the
request descriptor and generated validation metadata admit an invalid typed value;
otherwise verify the not-applicable declaration. Discover the canonical pre-JWT
set from `auth.PublicProcedures` plus separately mounted public self-authenticating
procedures and classify every member exactly once. Credential-bearing methods test
wrong and correct production credentials plus replay/rotation where relevant; the
wrong case asserts a method-specific non-authorizing result and zero protected
state effect, including idempotent-success `Logout`. Credentialless methods test
anonymous behavior, their deployed limiter, and validation only when applicable.
Mounted internal services test physical listener, intended ingress, peer classes,
and—in the gateway-to-control path—the exact authenticated gateway CN/device
routing binding with no absent-registry bypass. Explicitly unmounted methods test
non-exposure instead of fabricated success. Method-specific assertions verify
returned IDs/fields, read-after-write, NotFound after delete, asynchronous
convergence, and final execution/result state.

### Deep flows

Run ordered flows for:

1. login/refresh/logout/TOTP;
2. user/role/scope transitions with re-login;
3. agent enrollment/stream/sync/renewal/CRL;
4. gateway enrollment/internal trust/renewal/revocation;
5. actions/assignments/dispatch/execution;
6. OSQuery/inventory/logs/compliance/LUKS/LPS;
7. search convergence/rebuild;
8. OIDC;
9. terminal RPC + WebSocket + stream + GatewayService fan-out;
10. SCIM;
11. `agent-socket` initial enrollment/retry/non-replacement, `agent-signed-sync`
    scheduler/store behavior, and spec 38's root-only `agent-reenrollment` lifecycle.

### Stable real-agent lanes

The lane registry uses exact stable keys rather than workflow-job names:

- `agent-socket` owns initial Unix-socket enrollment, failed-initial retry,
  already-enrolled refusal, credential-status decisions used by ordinary install,
  and corrupt/non-absent non-replacement. Static descriptor presence of either
  `DeviceAuthService` method activates it; because both exist now, the complete
  baseline lands atomically with the registry.
- `agent-signed-sync` owns real scheduler/store/manifest behavior and one real
  authenticated scheduled effect. Registration of the `signed-manifest-v1`
  payload contract declares it ready.
- `agent-reenrollment` owns spec 38's root-only CLI, process lease, no-follow
  filesystem replacement, management binding, recovery, old-device cleanup, and
  backup-cleanup lifecycle. The spec-38 agent artifact registers
  `offline-reenrollment-v1`; spec 37 observes that registration and declares the
  lane ready. Ordinary socket enrollment remains owned by `agent-socket`.

Readiness capability and per-change selection are separate registry dimensions.
Canonical source-path selectors schedule already-ready lanes but do not activate
capabilities. The exact-set guard rejects duplicate aliases, stale capabilities,
activated lanes without scenarios, and a matches-zero registry. One lane may reuse
the same booted stack, but its scenario ledger and ownership remain distinct.

### Production-shaped ingress

Public Control calls from the host runner traverse Traefik TLS termination. Agent/Gateway calls traverse Traefik TCP passthrough and dynamic Redis routing. Only the separate internal actor may dial internal mTLS listeners. Include one browser Connect JSON/CORS flow, and fail if a public scenario target resolves to a Compose-internal service address.

### Execution ledger and completeness guard

Every executed scenario writes a ledger entry at execution time: procedure/arm
key, negative-probe correlator (where applicable), credential class, observed
outcome, and effect-assertion count. After diagnostics are captured, the
completeness guard recomputes the registered mounted set from the same registry
the offline guard uses and requires exact equality with the set of ledger
entries recording a real-assertion pass (AC 23, 26). Skips are first-class
failures: `t.Skip`, early return, selector filtering, and budget drops all
leave the procedure out of the passed set and fail the gate — the offline
exactness registry proves classification, this guard proves execution, and
neither may substitute for the other.

Reflection reconciliation runs against the booted stack before scenarios: each
server's served-procedure set (Connect/gRPC reflection where mounted, otherwise
the canonical production route catalog) is enumerated and any served procedure
missing from the offline registry aborts the run (AC 24). Negative probes derive
a unique run-scoped correlator embedded in the request (certificate CN, header,
request ID, or source tuple) so the final log gate can match every expected
rejection line 1:1 (AC 20).

### Candidate identity (consumes spec 39)

The reviewed change-set manifest — exactly three Git identities `sdk_sha`,
`server_sha`, `agent_sha`, their category ownership, the manifest-owned release
channel, single-build binary/image provenance, digest-ledger publication
authority, draft-Release ordering, and alias promotion/rollback — is specified
in spec 39 (split from this spec 2026-07-18). This suite consumes it: PR CI
runs offline exactness plus current-source amd64 E2E from the recorded
candidate set; the release rerun executes against the exact recorded
merge-result SHAs, never ambient branch heads; and the E2E startup ledger
records the identities the stack was built from so a wrong-source run is
detectable from artifacts alone (AC 17). A green run of this suite — including
the AC 23 completeness guard — against the captured digests is the precondition
spec 39's publication gate requires. The manually operated `deploy.sh` path
remains explicitly non-release (spec 39).

## Security considerations

- E2E fixtures receive no CA signing key, control private key, or datastore credentials.
- Wrong-peer-class/no-cert/cross-actor/scope/replay tests are explicit.
- Protocol actors use SDK production signature/sealing verification before acknowledging commands.
- Registration tokens do not authorize replacing an existing agent identity through the mode-0666 socket; reenrollment is a separate root-only offline operation.
- CORS remains an exact allow-list; no wildcard is introduced.
- Negative tests force fresh transports for CRL/TLS assertions. A still-valid revoked certificate must complete TLS and receive CRL-specific HTTP 403/log evidence; expiry, chain, routing, `VerifyDevice`, or generic stream failure never substitutes. Public-path proof is complemented by direct per-replica internal trust probes so one load-balanced response cannot mask a stale cache.

## Test requirements

### Offline PR tests

- Global descriptor discovery, canonical leading-slash Connect-key equality, and
  method-contract fingerprint parity over streaming flags plus recursively complete
  input/output descriptors for every unary and streaming method.
- Stream-arm exactness plus outer-field and recursive payload fingerprints with
  named arm contracts; arm checks never replace the complete envelope contract.
- Duplicate/stale/matches-zero checks. Red-check field-only unary changes; changes
  to `AgentMessage.id` / `ServerMessage.id`; addition/removal of non-oneof stream
  fields; and client-streaming, server-streaming, or bidirectional methods whose
  envelopes may have no oneof. Merge-base transition tests prove descriptor drift
  cannot be accepted by editing only the expected fingerprint: both the named
  payload-contract version and deterministic typed scenario-source fingerprint
  must also change, while comment/format-only scenario edits do not satisfy the
  guard.
- Descriptor/validation parity for malformed and validation-not-applicable
  declarations, plus mounted/unmounted exposure exactness and typed scenario
  compilation.
- Real-agent lane exactness separates readiness from selection. Existing
  `DeviceAuthService` descriptor presence, `signed-manifest-v1`, and
  `offline-reenrollment-v1` each map to one stable ready lane; path selectors only
  schedule ready lanes. Missing/duplicate/stale/placeholder lanes fail (AC 21).
- Completeness-guard red checks: a registered mounted scenario that `t.Skip`s,
  early-returns, is selector-filtered, or records zero effect assertions must
  fail the post-suite guard; a synthetic served-but-unregistered procedure must
  fail reflection reconciliation; the object-family probe registry has a
  matches-zero guard (AC 23–26).
- Existing handler-level validation/authz/security suites remain mandatory.

### Deployed E2E

- Every mounted discovered network method receives its registered contract
  scenario; every explicitly unmounted method receives production-listener
  non-exposure checks; both `DeviceAuthService` methods run in `agent-socket`
  (AC 1–6, 13).
- Bootstrap/search, action execution, terminal, OIDC, SCIM, renewal/revocation,
  ingress, exact gateway-CN/device binding, and browser CORS run as
  production-shaped deep flows (AC 7–16).
- The E2E startup ledger records the reviewed candidate identities the stack
  was built from and fails on ambient-source builds; manifest structure,
  provenance, publication ordering, alias rollback, and the non-release
  manual-deploy path are asserted by spec 39's workflow tests (AC 17–18).
- Reflection reconciliation runs against every deployed server before
  scenarios; the post-suite execution-completeness guard, per-family
  out-of-scope NotFound probes, effect-assertion counts, and TLS
  ownership/mode/dial-identity fidelity run as part of every deployed run
  (AC 23–27).
- Failure artifacts are redacted, and the final health/restart/log gate runs
  after intentional negative probes with 1:1 correlator matching (AC 19–20).
- Every activated stable real-agent lane runs and records its capability trigger in
  the scenario ledger (AC 21).

### Runtime budget

Target 4–7 minutes warm and 8–12 minutes cold; hard workflow bound 15 minutes.
Share the CRL convergence window and protocol actors, but do not disable
production timing/security controls solely to speed tests. The budget is
advisory pacing, never coverage authority: a run that exceeds it is a
performance regression to fix, while the AC 23 completeness guard fails any run
that skipped a mounted procedure or recorded an assertion-free success to stay
inside it. If exhaustive typed-success coverage cannot fit the bound, raise the
bound — never thin the assertions.

## Rejection paths

| Scenario | Error code | Client-visible message | Logged context |
|----------|------------|------------------------|----------------|
| New service/method/stream arm lacks classification | CI exactness failure | Missing generated procedure or oneof arm | Exact missing set and descriptor source |
| Existing method-contract or stream-arm fingerprint changes but payload-contract version and typed scenario source do not both change from merge-base | CI payload-contract failure | Descriptor change cannot be approved by replacing only its expected hash | Procedure/child key, old/new descriptor and scenario fingerprints, old/new payload-contract key |
| Stream envelope field outside a oneof changes without contract review | CI payload-contract failure | Complete stream method contract changed | Procedure, direction, field, old/new fingerprint |
| Explicitly unmounted procedure is reachable or lacks listener non-exposure evidence | CI/E2E exactness failure | Declared exclusion contradicts production mount | Procedure, listener/ingress, observed status |
| Stale or duplicate scenario registration | CI exactness failure | Stale or duplicate procedure | Exact stale/duplicate registration |
| E2E stack was built from an ambient branch head, matching tag, or published default instead of the recorded candidate set | E2E startup-ledger failure | Run identity does not match reviewed manifest (spec 39) | Expected and observed `sdk_sha`/`server_sha`/`agent_sha` |
| Mounted procedure has no real-assertion pass in the execution ledger (skip, early return, selector filter, budget drop) | CI completeness failure | Registered scenario did not execute against the deployed stack | Procedure key, scenario ID, ledger state |
| Deployed server serves a procedure absent from the offline registry | CI reflection-reconciliation failure | Deployed surface exceeds discovered registry | Server, procedure key, reflection/route source |
| Out-of-scope probe returns `PermissionDenied` or object data instead of `NotFound` | E2E security failure | Scope existence oracle or cross-scope data leak | Object family, actor scope, procedure, observed code |
| Typed-success ledger entry records zero effect assertions | CI completeness failure | Success scenario asserted nothing beyond status | Procedure, scenario ID, assertion count |
| Rejection log line matches zero or multiple negative-probe correlators | E2E log-gate failure | Unexplained or ambiguous TLS/ACL/auth rejection in logs | Log line class, matched correlator count, redacted line |
| Mounted TLS key/cert deviates from production ownership/mode/UID drop, or an internal dial identity mismatches | E2E TLS-fidelity failure | Deployment TLS posture not reproduced | Path, expected/observed owner+mode, dial address, certificate identity |
| Public pre-JWT procedure is unclassified or assigned both credential classes | CI exactness failure | Missing/duplicate public-procedure contract | Procedure and canonical mount/auth source |
| Wrong credential authorizes or mutates protected state | E2E security failure | Non-authorizing contract violated | Procedure, method-specific outcome, redacted state delta |
| Credentialless procedure is tested as requiring a credential, or validation applicability contradicts its request contract | E2E/CI contract failure | Scenario contradicts deployed anonymous/schema contract | Procedure, applicability, validation/rate-limit outcome |
| Missing JWT | `Unauthenticated` | Existing API authentication error | Procedure and scenario ID; no token |
| Zero-permission JWT | `PermissionDenied` | Existing API authorization error | Procedure, actor ID, and permission class |
| Malformed admin request when the typed contract admits one | `InvalidArgument` | Existing field-validation error | Procedure and safe validation context |
| Wrong or absent mTLS peer class | TLS or peer-middleware rejection | Connection/procedure unavailable to that peer | Listener, peer class, and rejection layer; no private material |
| Unexpected `NOPERM`, TLS, connection, panic, fatal, or internal error | E2E failure | Failed scenario and service | Redacted matching log lines and container state |
| Bootstrap user is absent from search | E2E assertion failure | Expected bootstrap entity not returned | Search request shape, convergence attempts, and safe entity ID |
| Old certificate expires, fails TLS, reaches a later handler, or only one Gateway replica proves rejection | E2E assertion failure | Revocation layer/fleet-wide cache was not proven | Certificate generation/time class, active entity ID, replica, and observed rejection layer |
| Destructive scenario runs before its declared phase | CI registry/order failure | Invalid scenario ordering | Scenario IDs and declared phases |
| Stable real-agent lane is missing, duplicated, stale, aliased, or activated but skipped | CI lane-exactness failure | Required capability lane did not run | Stable lane key, activation source, and scenario ledger |
| Diagnostic artifact contains secret material | CI redaction failure | Artifact publication blocked | Artifact path and detector category, never the secret value |

## Rollout and migration

Implement in ordered phases. First land the offline harness, the spec 39
change-set-manifest consumption, the execution ledger with its
completeness/reflection guards, exact lane/readiness registry, and the complete
`agent-socket` baseline atomically because existing `DeviceAuthService` descriptors
activate it immediately. Second land spec 38's management-device binding and exact
classifier foundation without registering `offline-reenrollment-v1`. Third complete
spec 34, its `signed-manifest-v1` contracts, and green `agent-signed-sync`,
registering readiness only in that completion candidate. Fourth complete spec 38's
signed-sync-backed reenrollment scenarios and green `agent-reenrollment`, then
register `offline-reenrollment-v1`. Fifth enable the exhaustive release dependency
and rerun the final reviewed three-SHA set.

`agent-socket` owns ordinary enrollment/status/non-replacement; the dormant spec-38
foundation does not activate its lane. “Activated but skipped fails CI” applies
from the commit that registers the complete capability/payload contract. Do not
make the exhaustive gate release-blocking until every ready lane is complete and
green. Final activation occurs only after compatible merges and a full rerun
against exact recorded merge-result `sdk_sha`, `server_sha`, and `agent_sha`, never
ambient branch heads. Keep the current smoke test as a fast infrastructure
preflight underneath the exhaustive suite.

Specs 34 and 38 consume the core harness, the spec 39 manifest, and the lane
registry — not only procedure discovery.

## References

- `server/deploy/smoke-test.sh`
- `server/.github/workflows/deploy-smoke.yml`
- `server/.github/workflows/release.yml`
- Spec 39 — release provenance and publication authority (split from this spec)
- Generated protobuf descriptors and `pmv1connect` clients in `sdk/`
- Existing handler/authz/stream-arm parity guards

## Audit findings (2026-07-18)

Pre-implementation review. The **offline** half of this gate is genuinely strong: it
discovers every procedure from `protoregistry.GlobalFiles`, classifies each exactly
once, fails CI on zero-matches / duplicates / stale / unclassified, and an
anti-rubber-stamp fingerprint transition blocks bumping an expected hash to hide
descriptor drift. It correctly targets the real `release.yml` provenance gaps
(matching-tag SDK substitution, non-atomic alias push, non-draft release, untested
arm64). But the **deployed-execution** half is under-specified relative to that
airtight offline contract, so as written the gate could report green while an
uncovered or mis-wired RPC ships:

- **[High / must-fix] Registration ≠ execution: no runtime guard that every
  registered scenario actually ran and asserted against the booted stack.** The
  exact-set / matches-zero authority governs the offline classification registry, not
  the execution path; a registered scenario that early-returns, `t.Skip`s, or is
  dropped under the runtime budget leaves its RPC uncovered while offline CI stays
  green. Fix: add an AC requiring a post-suite guard that the set of mounted
  procedures with a recorded real-assertion pass equals the registered mounted set
  (exact equality; any skip or zero-match fails CI), budget-independent.
- **[Medium] Descriptor discovery is only as complete as the E2E binary's import
  graph.** `GlobalFiles` is populated by linked-in generated packages, not by what the
  deployed servers serve; a served-but-unimported new service is invisible and the
  matches-zero guard still passes. Fix: mandate cross-checking the offline descriptor
  set against the deployed servers' reflection / served-procedure set, failing CI on
  any served procedure absent from the registry.
- **[Medium] The deployed gate omits cross-actor / scope-existence (NotFound)
  rejection** — exactly the mis-wiring handler tests (which bypass the deployed
  interceptor chain) cannot see. AC 4 asserts only anonymous→Unauthenticated and
  zero-perm→PermissionDenied. Fix: require at least one deployed out-of-scope NotFound
  probe per object family (not per RPC).
- **[Medium] The "no unclassified TLS/NOPERM error" log gate can launder real
  regressions through the intentional-negative-probe exception.** Fix: each negative
  probe carries a unique correlator and matches exactly one expected log line; any
  TLS / NOPERM / bad-cert line not matched 1:1 fails the gate.
- **[Medium] The 4-7 min / 15 min runtime budget is in tension with typed-success
  exhaustiveness for ~170 RPCs**, pushing toward the one-happy-path shortcut the spec
  bans. Fix: relax the budget or add a per-scenario assertion-count / state-delta
  requirement so "returned OK without asserting the effect" cannot satisfy
  typed-success.
- **[Low-Medium] TLS key ownership/mode/UID-drop fidelity is not restated as an AC**
  for the new TLS surfaces this spec adds (Traefik termination, gateway passthrough,
  per-replica CRL mTLS). Moot while control/gateway run as root, latent if they ever
  adopt a non-root `USER`. Fix: add an AC asserting mounted key/cert material
  reproduces production ownership/mode and internal dials verify both dial-address and
  TLS identity.
- **[Low, quality] Non-atomic ACs; AC 17/18 (release provenance) are a separate
  feature** bolted onto the E2E gate and should be split into their own spec. Also
  reword the Overview: this *supersedes as the release gate* but *retains* the smoke
  test as a preflight (additive, not a replacement).

Close the first two (runtime execution-completeness guard + reflection reconciliation)
before this becomes the release authority.

### Remediation (2026-07-18, WS-E amendment)

All findings above are closed in this draft:

- **Registration ≠ execution (High)** → AC 23 + the "Execution ledger and
  completeness guard" design section: post-suite exact equality between the
  registered mounted set and the ledger's real-assertion passes,
  budget-independent; `t.Skip`, early return, selector filtering, and budget
  drops all fail CI.
- **Import-graph blindness (Medium)** → AC 24: pre-scenario reflection/served-set
  reconciliation against every deployed server; any served-but-undiscovered
  procedure aborts the run.
- **Missing cross-actor NotFound (Medium)** → AC 25: one deployed out-of-scope
  `NotFound` probe per object family, family list discovered from the registry
  (matches-zero guarded), never hardcoded.
- **Negative-probe laundering (Medium)** → AC 20 rewritten: unique run-scoped
  per-probe correlators with strict 1:1 expected-line matching; zero-matched and
  multiply-matched rejection lines both fail.
- **Budget vs. exhaustiveness (Medium)** → AC 26 + Runtime budget reworded:
  per-scenario effect-assertion counts recorded in the ledger; zero-assertion
  success never counts toward AC 23; the budget is advisory, never coverage
  authority — raise the bound rather than thin the assertions.
- **TLS fidelity (Low-Medium)** → AC 27: production ownership/modes/UID drops
  (root-owned `0600` keys) and dial-address + TLS-verification-identity
  assertions restated for this suite's TLS surfaces.
- **Provenance split + non-atomic ACs (Low)** → old ACs 17/18, the CI/release
  architecture section, and their rejection rows moved to spec 39 (release
  provenance and publication authority). AC 17 retains only the consumer
  contract (build from the recorded immutable candidate set, ledger-recorded
  identities); AC 18 is the split pointer. The Overview now states
  supersede-as-release-gate with the smoke test retained as preflight.
