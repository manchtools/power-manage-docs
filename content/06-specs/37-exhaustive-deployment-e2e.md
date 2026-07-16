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

1. Given generated Power Manage descriptors, when the offline E2E registry test runs, then every fully qualified procedure key (`<service>/<method>`) is classified exactly once as public control, control-internal mTLS, gateway-agent mTLS, gateway-control mTLS, agent-local Unix socket, or explicitly unmounted; zero matches, duplicates, stale entries, and unclassified procedures fail CI.
2. Given the current protocol surface, when the exact-set guard runs, then every discovered procedure key has a typed scenario matrix covering each required credential or peer-trust path and expected outcome, and both `DeviceAuthService` methods have registered Unix-socket scenarios; discovered counts are diagnostic only and exact set equality is authoritative.
3. Given `AgentService.Stream`, when the exact-set guard runs, then every generated client-to-server and server-to-client oneof arm has a disjoint child key under the stream procedure and a registered scenario; adding an arm fails CI until it is classified and covered.
4. Given a protected Control RPC, when its deployed contract scenario runs with a per-method authentication-safe fixture that passes all non-auth validation, then an anonymous request returns `Unauthenticated`, a zero-permission user returns `PermissionDenied`, an admin malformed request returns `InvalidArgument`, and a domain-safe typed request reaches and asserts its method-specific outcome.
5. Given a public JWT-bypass RPC or `GatewayAuthService.EnrollGateway`, when its scenario runs, then schema-valid wrong credentials are rejected and the correct production credential mechanism succeeds; replay/rotation semantics are asserted where applicable.
6. Given an internal mTLS RPC, when its scenario runs, then no certificate and each wrong peer class are rejected, the correct peer class reaches domain behavior, and the wrong listener does not expose the procedure.
7. Given a fresh Compose stack, when E2E fixtures initialize, then bootstrap-admin login succeeds and Search returns the bootstrap user without a manual rebuild.
8. Given real indexed state, when Search and RebuildSearchIndex scenarios run, then convergence is polled, exact entities are returned, rebuild preserves expected contents, and unrelated Valkey keys/dangerous commands remain denied.
9. Given a generated-client protocol agent, when dispatch, inventory, OSQuery, logs, compliance, LUKS/LPS, and terminal flows run, then it verifies production signatures/sealing before responding and the corresponding RPCs reach their expected final state.
10. Given terminal E2E, when StartTerminal succeeds, then a real WebSocket client presents the bearer subprotocol, completes STARTED, drives input/resize/stop through the agent stream, and proves GatewayService list/terminate fan-out through control.
11. Given SSO E2E, when the full OIDC flow runs, then production discovery, PKCE, nonce/state, token exchange, JWKS verification, identity creation/linking, and replay rejection are exercised without disabling SSRF protection.
12. Given SCIM E2E, when discovery and authenticated user/group operations run through the deployed HTTP handler, then responses and persisted state match SCIM behavior.
13. Given agent-local E2E, when the real agent daemon exposes `/run/pm-agent/enroll.sock`, then both DeviceAuthService RPCs are exercised through the Unix socket, including failed-enrollment retry and the explicit reenrollment behavior approved separately.
14. Given public E2E calls, then Control uses production-shaped Traefik TLS termination and Gateway uses Traefik TCP passthrough/dynamic Redis routes; direct internal listeners are used only for internal-plane trust probes.
15. Given a browser-compatible preflight and Connect JSON request from `https://app.power-manage.manchtools.com`, then Traefik/control return the exact CORS headers and usable response expected by the hosted web app.
16. Given certificate renewal/revocation, when the old credential is superseded while the entity remains active, then a fresh transport with the old certificate is rejected by the CRL gate and the renewed certificate succeeds; failures at later handler layers do not count as revocation proof.
17. Given a PR changing server, agent, SDK, deploy, or E2E code, then CI builds current-source amd64 images and matching generated-client E2E binaries from explicitly recorded immutable repository and SDK SHAs and tests those images, never a previously published default tag.
18. Given a release, then every architecture image is built once from the same recorded source and dependency inputs, pushed under a run-scoped digest, and provenance-checked; amd64 exhaustive E2E and an arm64 boot probe run against those exact digests before the already-tested digests are assembled into version tags, multi-arch manifests, `latest`/`latest-rc`, or a GitHub Release without rebuilding.
19. Given an E2E failure, then CI uploads complete redacted Compose state, health/restart counts, service logs, scenario ledger, and JUnit output before teardown; secrets, `.env`, private keys, tokens, and raw secret-bearing payloads are never uploaded.
20. Given intentional negative probes, then final post-suite checks still require healthy containers, no unexpected restarts, and no unclassified panic/fatal/internal/ACL/TLS errors.

## Out of scope

- Replacing existing real-handler correct/absent/malformed and fine-grained authorization tests. Deployed E2E complements them; it cannot prove every field/scope rule economically.
- Direct database writes, synthetic JWTs/auth contexts, handler instantiation, privileged CA/control private-key mounts, or direct Valkey business-state seeding.
- Treating one happy path and one generic rejection as semantic exhaustiveness for a complex RPC.
- Enabling a partial release gate with skipped/placeholding RPC entries. The release dependency activates only when exact coverage is complete.

## Technical design

### Affected packages and repositories

- `server/e2e/` — E2E registry, generated clients, fixtures, protocol actors, Compose integration, and scenario ledger.
- `server/deploy/` and `server/.github/workflows/` — real-stack execution, current-image builds, diagnostics, and release gating.
- `agent/` — real-daemon Unix-socket lane for `DeviceAuthService` and explicit reenrollment coverage.
- `sdk/` — consumed generated descriptors, clients, and production verification helpers.
- `docs/` — this spec and operator/testing documentation.

### Proto changes

None initially. The suite consumes generated descriptors and clients without adding a testing-only RPC or message. Any future production proto change remains independently specified and automatically makes the exact-set guard fail until its deployed scenario is registered.

### Database changes

None. E2E fixtures create and inspect business state only through deployed APIs; they do not add test tables or write projections directly.

### New dependencies

None initially. Reuse the generated Connect clients, Go standard-library HTTP/TLS test servers, the existing `github.com/coder/websocket` dependency, and the current Compose/Docker tooling. A new dependency requires a concrete missing capability and separate justification.

### Offline exactness registry

Create `server/e2e/rpc/` as a static Go test package. Discover Power Manage services from `protoregistry.GlobalFiles`; do not hardcode proto filenames. The primary key is the fully qualified procedure name (`<service>/<method>`). Stream payload arms use disjoint child keys (`<procedure>#client:<arm>` and `<procedure>#server:<arm>`), so procedure-plane classification and arm coverage cannot mask each other.

Each procedure entry declares:

- its listener plane;
- every required credential or peer-trust class;
- the expected outcome for each trust class;
- an authentication-safe request factory that passes every non-auth validation gate;
- a malformed request factory where applicable;
- stateful/side-effect ordering policy;
- typed semantic success scenarios;
- local-only/unmounted exclusions.

Non-protobuf HTTP, SCIM, health, and WebSocket endpoints use a separate exact registry discovered from one canonical production route catalog shared by route mounting and E2E; a duplicated test-only route list is forbidden. Every route key declares ingress, credential, and expected-outcome scenarios with the same zero-match, duplicate, stale, and missing guards.

Every reachable procedure registers typed success and rejection scenarios using generated procedure constants and clients. Reflection is allowed for discovery and exactness only, not for semantic successful calls.

### Deployed world

Public scenarios run from the CI host against only the mapped Traefik ports, with test DNS names resolving to the host. They are never attached to `pm-internal` and cannot resolve or dial control, gateway, Postgres, Valkey, or indexer service addresses directly.

Internal trust probes run in a separate short-lived actor attached only to `pm-internal`. It receives the smoke CA certificate and only its own API-issued peer identities; it receives no public bootstrap password, `ca.key`, `control.key`, datastore key, or Valkey credential. The suite asserts that public procedures are exercised by the host runner and internal procedures by the internal actor, preventing a scenario from silently bypassing its required ingress.

All business state is created through generated RPC clients. Fixtures use run-ULID names and scenario-owned cleanup. Long-lived protocol actors are shared only where the deployed state machine requires it.

### Contract sweep

For protected Control methods, run schema-valid unauthenticated, schema-valid zero-permission, malformed-admin, and domain-safe typed calls. Mechanism-specific public methods test their real credentials. Internal services test listener exposure and peer classes. Method-specific assertions verify returned IDs/fields, read-after-write, NotFound after delete, asynchronous convergence, and final execution/result state.

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
11. agent-local DeviceAuthService.

### Production-shaped ingress

Public Control calls from the host runner traverse Traefik TLS termination. Agent/Gateway calls traverse Traefik TCP passthrough and dynamic Redis routing. Only the separate internal actor may dial internal mTLS listeners. Include one browser Connect JSON/CORS flow, and fail if a public scenario target resolves to a Compose-internal service address.

### CI/release architecture

Resolve and record immutable source SHAs for each participating repository and one SDK SHA before building. PR CI runs offline exactness plus current-source amd64 E2E. Release CI builds each architecture once from those inputs, records image digests and provenance attestations, runs amd64 exhaustive E2E plus the arm64 boot probe against the recorded digests, and publishes those exact digests without rebuilding. Preserve complete redacted artifacts on failure.

## Security considerations

- E2E fixtures receive no CA signing key, control private key, or datastore credentials.
- Wrong-peer-class/no-cert/cross-actor/scope/replay tests are explicit.
- Protocol actors use SDK production signature/sealing verification before acknowledging commands.
- Registration tokens do not authorize replacing an existing agent identity through the mode-0666 socket; reenrollment is a separate root-only offline operation.
- CORS remains an exact allow-list; no wildcard is introduced.
- Negative tests force fresh transports for CRL/TLS assertions and verify the rejection layer, not merely an eventual error.

## Test requirements

### Offline PR tests

- Global descriptor discovery and exact registry equality.
- Duplicate/stale/matches-zero checks.
- Stream-arm exactness.
- Typed scenario compilation.
- Existing handler-level validation/authz/security suites remain mandatory.

### Deployed E2E

- Every discovered network method receives its registered contract scenario; both `DeviceAuthService` methods run in the real-agent Unix-socket lane (AC 1–6, 13).
- Bootstrap/search, action execution, terminal, OIDC, SCIM, renewal/revocation, ingress, and browser CORS run as production-shaped deep flows (AC 7–16).
- Current-source image provenance and staged release publication are asserted by workflow tests and the E2E startup ledger (AC 17–18).
- Failure artifacts are redacted and the final health/restart/log gate runs after intentional negative probes (AC 19–20).

### Runtime budget

Target 4–7 minutes warm and 8–12 minutes cold; hard workflow bound 15 minutes. Share the CRL convergence window and protocol actors, but do not disable production timing/security controls solely to speed tests.

## Rejection paths

| Scenario | Error code | Client-visible message | Logged context |
|----------|------------|------------------------|----------------|
| New service/method/stream arm lacks classification | CI exactness failure | Missing generated procedure or oneof arm | Exact missing set and descriptor source |
| Stale or duplicate scenario registration | CI exactness failure | Stale or duplicate procedure | Exact stale/duplicate registration |
| Current code is paired with an old published image | CI provenance failure | Source/image SHA or digest mismatch | Expected and observed immutable identities |
| Missing JWT | `Unauthenticated` | Existing API authentication error | Procedure and scenario ID; no token |
| Zero-permission JWT | `PermissionDenied` | Existing API authorization error | Procedure, actor ID, and permission class |
| Malformed admin request | `InvalidArgument` | Existing field-validation error | Procedure and safe validation context |
| Wrong or absent mTLS peer class | TLS or peer-middleware rejection | Connection/procedure unavailable to that peer | Listener, peer class, and rejection layer; no private material |
| Unexpected `NOPERM`, TLS, connection, panic, fatal, or internal error | E2E failure | Failed scenario and service | Redacted matching log lines and container state |
| Bootstrap user is absent from search | E2E assertion failure | Expected bootstrap entity not returned | Search request shape, convergence attempts, and safe entity ID |
| Old certificate is rejected only after entity deletion | E2E assertion failure | Revocation layer was not proven | Certificate generation, active entity ID, and observed rejection layer |
| Destructive scenario runs before its declared phase | CI registry/order failure | Invalid scenario ordering | Scenario IDs and declared phases |
| Diagnostic artifact contains secret material | CI redaction failure | Artifact publication blocked | Artifact path and detector category, never the secret value |

## Rollout and migration

Implement in five phases: offline harness/exactness; public Control scenarios; protocol actors/deep flows; internal trust/local-agent lanes; deployment/release gating. Do not switch release publication to the exhaustive gate until all exact registries are complete and green. Keep the current smoke test as a fast infrastructure preflight underneath the exhaustive suite.

## References

- `server/deploy/smoke-test.sh`
- `server/.github/workflows/deploy-smoke.yml`
- `server/.github/workflows/release.yml`
- Generated protobuf descriptors and `pmv1connect` clients in `sdk/`
- Existing handler/authz/stream-arm parity guards
