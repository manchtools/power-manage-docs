---
title: "Exhaustive deployment E2E gate"
status: draft
created: 2026-07-16
---

# Exhaustive deployment E2E gate

## Overview

Replace health-based and hand-picked deployment probes with a self-discovering, generated-client E2E contract suite that boots the real current-commit images from the real Compose artifacts and exercises every deployed Power Manage RPC, stream message arm, listener/authentication plane, and critical cross-service state machine before a release can publish version tags or manifests.

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
17. Given a PR or coordinated clean-break candidate changing SDK,
    server/deploy/E2E, or agent, then its reviewed change-set manifest records
    exactly `sdk_sha`, `server_sha`, and `agent_sha`. Generated clients are part of
    `sdk_sha`; deploy, Compose, workflow, and E2E source are part of `server_sha`.
    CI builds current-source amd64 binaries/images from that immutable candidate
    set, verifies server and agent dependency graphs resolve the recorded
    `sdk_sha`, and never substitutes a branch, matching tag, or published default.
18. Given a release, when each coordinated change has merged, then the coordinator
    records the exact resulting commit object for that reviewed change as
    `sdk_sha`, `server_sha`, or `agent_sha`; CI never re-resolves ambient branch
    heads. Reachability from configured release branches and SDK dependency
    resolution are verified before the complete gate reruns. Each
    service/architecture binary is built once, hashed, attested, and used as both
    the image input and GitHub Release asset; each image is built once under a
    run-scoped staging reference and every later test/publication uses its captured
    digest. AMD64 exhaustive E2E and an arm64 boot probe run against those exact
    digests. A green mutable PR-head result does not authorize publication, and a
    changed SHA requires a new reviewed manifest and full rerun. The green
    manifest-triggered gate—not a pre-existing `v*` tag—is the only actor allowed
    to create repository tags/releases or promote OCI tags. Repository Git tags
    map to their own SHA (`sdk_sha`, `server_sha`, or `agent_sha`); OCI tags map to
    tested manifest digests whose provenance records all applicable Git identities.
    The GitHub Release remains draft while immutable version manifests and then
    floating aliases are published and verified. Because registry alias updates are
    not atomic across services, partial failure triggers best-effort rollback to the
    captured prior aliases and keeps the Release draft. The reviewed digest ledger,
    not a floating alias, is publication authority; the Release becomes public only
    after every intended alias matches that ledger.
19. Given an E2E failure, then CI uploads complete redacted Compose state, health/restart counts, service logs, scenario ledger, and JUnit output before teardown; secrets, `.env`, private keys, tokens, and raw secret-bearing payloads are never uploaded.
20. Given intentional negative probes, then final post-suite checks still require healthy containers, no unexpected restarts, and no unclassified panic/fatal/internal/ACL/TLS errors.
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

## Out of scope

- Replacing existing real-handler correct/absent/malformed and fine-grained authorization tests. Deployed E2E complements them; it cannot prove every field/scope rule economically.
- Direct database writes, synthetic JWTs/auth contexts, handler instantiation, privileged CA/control private-key mounts, or direct Valkey business-state seeding.
- Treating one happy path and one generic rejection as semantic exhaustiveness for a complex RPC.
- Enabling a partial release gate with skipped/placeholding RPC entries. The release dependency activates only when exact coverage is complete.

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

### CI/release architecture

The reviewed change-set manifest contains exactly three Git identities:
`sdk_sha`, `server_sha`, and `agent_sha`. SDK-generated clients belong to
`sdk_sha`; Compose, deploy scripts, workflows, and E2E source belong to
`server_sha`. Descriptor fingerprints, binary hashes, image digests, and
provenance attestations are separate non-Git identities and never masquerade as
repository SHAs. Non-identity metadata includes one manifest-owned `stable` or
`prerelease` channel so repositories do not infer channel independently from tag
spelling.

An ordinary PR uses a reviewed compatible candidate set. A coordinated clean
break supplies all three candidates so no member is tested against an old
incompatible default. PR CI runs offline exactness plus current-source amd64 E2E
from that recorded set. After each coordinated merge, the coordinator records the
exact resulting commit object for that reviewed change; release CI never resolves
a mutable branch or matching tag. It verifies each commit is reachable from the
configured release branch and that server/agent dependency graphs resolve
`sdk_sha`, then reruns the complete gate. A changed SHA invalidates the manifest
and requires review plus a full rerun.

Each service/architecture binary is built exactly once, hashed, and attested.
Those exact bytes are both the OCI image input and the GitHub Release binary asset.
Each OCI image is built exactly once under a run-scoped staging reference; its
registry digest is captured and all E2E, arm64 boot, provenance, and publication
steps use `repository@sha256:…`. Version and floating manifests contain only those
tested digests. Server Git tags/releases dereference to `server_sha`, agent tags to
`agent_sha`, and both SDK Go-module/calendar tags to `sdk_sha`; tag names need not
match across repositories. OCI tags point to tested digests whose provenance
records the Git identities.

The green manifest-triggered final gate—not a pre-existing release tag—is the sole
publication authority. For a server release unit, CI first creates the server
GitHub Release as a **draft** with the matching deploy tree, original binaries,
checksums, reviewed change-set manifest, digest ledger, and provenance. It then
publishes and verifies immutable control/gateway/indexer version manifests. Before
changing floating aliases it records each prior alias digest; it updates
`latest` or `latest-rc` per service, then verifies every alias against the reviewed
digest ledger. Registry operations cannot make three aliases atomic. If any update
or verification fails, CI attempts to restore every changed alias to its recorded
prior digest, keeps the GitHub Release draft, and reports any incomplete rollback
as a publication incident. Floating aliases are convenience pointers only; the
reviewed digest ledger remains authoritative. CI publishes the GitHub Release only
after all immutable manifests and intended aliases verify. The manually operated
`deploy.sh` path is explicitly non-release: local builds use a source-derived
`dev-<server_sha>-<sdk_sha>-<arch>` identity and a temporary deployment override,
never a released version, `latest`, `latest-rc`, or the operator's persisted
`IMAGE_TAG`. Preserve complete redacted artifacts on failure.

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
- Existing handler-level validation/authz/security suites remain mandatory.

### Deployed E2E

- Every mounted discovered network method receives its registered contract
  scenario; every explicitly unmounted method receives production-listener
  non-exposure checks; both `DeviceAuthService` methods run in `agent-socket`
  (AC 1–6, 13).
- Bootstrap/search, action execution, terminal, OIDC, SCIM, renewal/revocation,
  ingress, exact gateway-CN/device binding, and browser CORS run as
  production-shaped deep flows (AC 7–16).
- Candidate and exact reviewed post-merge `sdk_sha`/`server_sha`/`agent_sha`
  identity, dependency resolution, single-build binary/image provenance,
  repository-specific tag mapping, draft-Release ordering, immutable-manifest and
  per-service floating-alias verification, injected partial-alias failure with
  rollback/kept-draft behavior, and the non-release manual-deploy path are asserted
  by workflow tests and the E2E startup ledger (AC 17–18).
- Failure artifacts are redacted and the final health/restart/log gate runs after intentional negative probes (AC 19–20).
- Every activated stable real-agent lane runs and records its capability trigger in
  the scenario ledger (AC 21).

### Runtime budget

Target 4–7 minutes warm and 8–12 minutes cold; hard workflow bound 15 minutes. Share the CRL convergence window and protocol actors, but do not disable production timing/security controls solely to speed tests.

## Rejection paths

| Scenario | Error code | Client-visible message | Logged context |
|----------|------------|------------------------|----------------|
| New service/method/stream arm lacks classification | CI exactness failure | Missing generated procedure or oneof arm | Exact missing set and descriptor source |
| Existing method-contract or stream-arm fingerprint changes but payload-contract version and typed scenario source do not both change from merge-base | CI payload-contract failure | Descriptor change cannot be approved by replacing only its expected hash | Procedure/child key, old/new descriptor and scenario fingerprints, old/new payload-contract key |
| Stream envelope field outside a oneof changes without contract review | CI payload-contract failure | Complete stream method contract changed | Procedure, direction, field, old/new fingerprint |
| Explicitly unmounted procedure is reachable or lacks listener non-exposure evidence | CI/E2E exactness failure | Declared exclusion contradicts production mount | Procedure, listener/ingress, observed status |
| Stale or duplicate scenario registration | CI exactness failure | Stale or duplicate procedure | Exact stale/duplicate registration |
| Change-set manifest has a fourth Git SHA, omits one of the three keys, or confuses a digest/fingerprint with a SHA | CI identity failure | Invalid `sdk_sha`/`server_sha`/`agent_sha` manifest | Exact key/category and safe observed identity |
| Recorded merged SHA is changed, unreachable, re-resolved from a mutable ref, or dependency graph does not resolve `sdk_sha` | CI provenance failure | Reviewed source set invalid; release blocked | Expected and observed immutable identities/dependency result |
| A tag-triggered path publishes before the manifest gate, a Git tag targets the wrong repository SHA, or an OCI tag references an untested digest | CI publication failure | Publication identity/order mismatch; GitHub Release remains draft | Repository, tag/channel, expected SHA/digest, safe observed identity |
| Floating alias update/verification fails after another service alias changed | CI publication failure plus rollback attempt | Release remains draft; changed aliases are restored to captured prior digests where possible, and incomplete rollback is an incident | Service alias, prior/target/observed digest, rollback status; reviewed digest ledger remains authoritative |
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

Implement in ordered phases. First land the offline harness, three-key reviewed
change-set manifest, exact lane/readiness registry, and the complete
`agent-socket` baseline atomically because existing `DeviceAuthService` descriptors
activate it immediately. Second land spec 38's management-device binding and exact
classifier foundation without registering `offline-reenrollment-v1`. Third complete
spec 34, its `signed-manifest-v1` contracts, and green `agent-signed-sync`,
registering readiness only in that completion candidate. Fourth complete spec 38's
signed-sync-backed reenrollment scenarios and green `agent-reenrollment`, then
register `offline-reenrollment-v1`. Fifth enable the exhaustive release dependency
and rerun the final reviewed three-SHA set. Specs 34 and 38 consume the core
harness, three-key manifest, and lane registry—not only procedure discovery.

`agent-socket` owns ordinary enrollment/status/non-replacement; the dormant spec-38
foundation does not activate its lane. “Activated but skipped fails CI” applies
from the commit that registers the complete capability/payload contract. Do not
make the exhaustive gate release-blocking until every ready lane is complete and
green. Final activation occurs only after compatible merges and a full rerun
against exact recorded merge-result `sdk_sha`, `server_sha`, and `agent_sha`, never
ambient branch heads. Keep the current smoke test as a fast infrastructure
preflight underneath the exhaustive suite.

## References

- `server/deploy/smoke-test.sh`
- `server/.github/workflows/deploy-smoke.yml`
- `server/.github/workflows/release.yml`
- Generated protobuf descriptors and `pmv1connect` clients in `sdk/`
- Existing handler/authz/stream-arm parity guards
