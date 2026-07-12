---
title: "Gateway self-enrollment and control-plane HA"
status: draft
created: 2026-07-12
---

# Gateway self-enrollment and control-plane HA

## Overview

Today a gateway's mTLS identity is a **static, operator-generated certificate**
(`deploy/setup.sh`: `CN=${GATEWAY_DOMAIN}`, a class-level
`spiffe://power-manage/gateway` SAN, no per-gateway identity) loaded from
`--tls-cert`/`--tls-key`. Every gateway in a deployment presents the same
domain-scoped, anonymous-within-its-class cert, and there is **no way to issue,
renew, or revoke an individual gateway**. The device→gateway origin-binding
check ([binding.go:37-42](../../../server/internal/gateway/registry/binding.go))
already documents this as a known limitation and works around it by trusting a
*self-asserted* `claimedGatewayID` cross-checked against the routing registry.

This spec gives gateways the same **enroll → per-identity cert → renew →
revoke** lifecycle that agents already have, reusing the agent machinery
(`ca.IssueCertificateFromCSR`, the token/rate-limit path from
`ControlService.Register`, the `pm:crl:revoked` CRL). An operator can spin up
additional gateway replicas under load; each **self-enrolls** with a shared
bootstrap token, obtains a cert whose `CN` is its own ULID `gateway_id`, and
that specific gateway can be **individually revoked**, enforced on the
control-facing plane (already CRL-gated) *and*, net-new, on the agent-facing
plane so a revoked gateway is rejected by agents too.

While the identity work is open it also settles the **multi-instance control**
story: control replicas are *fungible* (they share the CA key, JWT secret,
encryption key, and task-signing key, all already externalized config) behind
a load balancer over shared Postgres + Valkey. No leader election is needed:
the periodic workers already single-flight on Postgres advisory locks. This
spec documents that model, closes the *one* periodic loop that lacks the lock,
and asserts the OIDC flow-state is replica-safe.

## Motivation

- **Horizontal gateway scaling is unsafe to operate today.** Adding a gateway
  means hand-minting and distributing a cert. There is no per-gateway identity,
  so a compromised gateway cannot be revoked without rotating the shared cert
  for the whole fleet.
- **The origin-binding control is weaker than it should be.** WS2/SA-C2
  ([#404](https://github.com/manchtools/power-manage-server/pull/404)) had to
  trust a self-asserted `claimedGatewayID` *precisely because* the cert carries
  no identity. With a per-gateway `CN`, the binding check reads identity from
  the authenticated peer cert instead of a request field.
- **Revocation must reach the agent-facing plane.** A gateway is the agent's
  mTLS *server*. Today a revoked cert is rejected on the control-facing plane
  (WS12), but **agents never check a CRL against the gateway they connect to**,
  so "revoke a compromised gateway" does not actually cut it off from the
  fleet. This spec closes that.
- **Multi-instance control is nearly free but undocumented.** The crypto
  material is already shared config and the projectors are idempotent; the
  work is to document it, add one missing advisory lock, and prove OIDC state
  is replica-safe, so operators can run control HA with confidence.

Related: [ADR-0005 (gateway↔control device-origin binding)], WS12 (CRL
fail-closed), spec 29 (task-HMAC, the *compensating* control that assumes a
Valkey compromise; this spec hardens *identity*, spec 32 hardens datastore
auth).

## Acceptance criteria

Numbered, testable. Grouped by part.

### Part A: Gateway self-enrollment

1. Given a gateway configured with a valid bootstrap token, when it calls
   `GatewayAuthService.EnrollGateway` with a PEM PKCS#10 CSR, then control
   validates the token in **constant time** against
   `CONTROL_GATEWAY_ENROLL_TOKEN`, assigns a fresh ULID `gateway_id`, signs the
   CSR with `CN = SerialNumber = gateway_id` and a class-level
   `spiffe://power-manage/gateway` SAN, and returns `{ca_cert, certificate}`.
   The response does **not** carry a separate `gateway_id` field: the cert `CN`
   is the single source of truth; the gateway reads its own id by parsing the
   returned certificate (no field that could drift from the cert it is issued
   against).
2. Given an `EnrollGateway` CSR that requests any SAN (DNS/IP/email/URI), when
   it is processed, then it is rejected: the CA stamps the class SAN itself
   and refuses caller-supplied SANs (existing
   `IssueCertificateFromCSR` behavior).
3. Given an `EnrollGateway` call with an absent, wrong, or malformed token, when
   validated, then it is rejected `PermissionDenied` ("invalid enrollment
   token") with no `gateway_id` allocated and no event emitted, AND control
   emits a WARN log recording the requester IP, the supplied hostname (if any),
   and a short token **hash** prefix (never the token itself), so repeated
   enrollment probing against the shared bootstrap token is observable and
   alertable. (This is the observability backstop for the one credential that
   gates the whole surface.)
4. Given more than **5 `EnrollGateway` attempts per minute from one client IP**,
   when the 6th arrives, then it is rejected `ResourceExhausted` (the
   `Register`/`RenewCert` rate-limiter pattern, keyed by client IP).
5. Given a successful enrollment, when it commits, then a `GatewayEnrolled`
   event is appended (`gateway_id`, cert **fingerprint**, `not_after`,
   `hostname`), projected into `gateways_projection`, and audit-visible: the
   fingerprint↦gateway_id mapping revocation needs.
6. Given a gateway, when it boots, then enrollment is the **only** way it
   obtains its cert: the static `--tls-cert`/`--tls-key` flags are **removed**
   (clean break, no compat fallback). It generates a keypair (private key never
   leaves the process), submits a CSR, and serves both its agent-facing mTLS
   listener and its control-facing client with the issued cert; its `gateway_id`
   is read from the issued cert's `CN`, not from config. A gateway with no
   reachable control or invalid token cannot start; it has no other identity to
   fall back to (fail closed, by design).

### Part B: Gateway certificate renewal

7. Given a gateway cert issued with a **45-day** validity (short-lived,
   mirroring the planned short-TTL public-certificate posture), when the gateway
   reaches ≥80% of that lifetime (~36 days), then it calls
   `InternalService.RenewGatewayCertificate` over the control-facing mTLS plane
   presenting its current (valid, non-revoked) gateway cert; control re-signs a
   new cert with the **same** `gateway_id`, revokes the superseded fingerprint
   into the CRL, emits `GatewayCertRenewed`, and the gateway swaps the cert
   without dropping agent connections. A revoked or abandoned gateway cert
   additionally **self-expires within 45 days** even if the CRL is unavailable.
8. Given a `RenewGatewayCertificate` call whose presented cert is revoked, not
   `PeerClassGateway`, or fails proof-of-possession against the new CSR, when
   validated, then it is rejected and no new cert is issued.

### Part C: Origin-binding upgrade

9. Given the device→gateway binding check, when an `InternalService` request or
   `control:inbox` event arrives from a gateway, then `gateway_id` is read from
   the **authenticated peer cert `CN`**, not a self-asserted request field, and
   cross-checked against the routing registry as before (a mismatch →
   `PermissionDenied`; device not live on any gateway → `FailedPrecondition`;
   fail-closed).

### Part D: Agent-facing gateway revocation (net-new)

10. Given a revoked gateway, when an operator calls
    `ControlService.RevokeGatewayCertificate(gateway_id)` (permission-gated,
    audit-logged), then (a) that gateway's fingerprint is added to
    `pm:crl:revoked` and a `GatewayRevoked` event is emitted; (b) the revoked
    gateway, once its cert is rejected as revoked (on the control plane or at
    renewal), MUST **halt and alert**: it must NOT fall back to
    `EnrollGateway` to mint itself a fresh identity with the still-held
    bootstrap token; and (c) durable revocation against a *compromised* host
    (which will ignore (b)) is completed by rotating
    `CONTROL_GATEWAY_ENROLL_TOKEN`, since a still-valid shared token otherwise
    permits a new, distinct `gateway_id` to enroll. The 45-day TTL (AC 7) bounds
    the window if neither (a) nor (c) is applied.
11. Given an agent, when it connects (or is connected) to a gateway, then it
    verifies the gateway's **server-cert fingerprint** against a
    control-sourced CRL and refuses the connection if revoked.
12. Given the agent's CRL, when the agent cannot refresh it from control within
    a bounded freshness window, then the agent **fails closed** (treats the
    gateway as untrusted) rather than trusting a stale CRL, matching the
    boot-time fail-closed posture the gateway already uses for the agent CRL.
13. Given `ControlService.GetCertificateRevocationList`, when an agent fetches
    it over CA-pinned TLS, then control returns the active revoked fingerprints
    plus a `not_after`/validity window; the call is rate-limited and requires no
    gateway relay (agents already reach control directly for
    `Register`/`RenewCertificate`).

### Part E: Multi-instance control

14. Given N control replicas behind a load balancer sharing one Postgres + one
    Valkey and identical `CONTROL_CA_KEY` / `CONTROL_JWT_SECRET` /
    `CONTROL_ENCRYPTION_KEY` / `PM_TASK_SIGNING_KEY`, when any replica handles a
    request, then it appends to the shared event store and its synchronous
    idempotent (`ON CONFLICT`) projectors run once per append: no cross-replica
    double-projection and no missed projection.
15. Given N control replicas, when the stale-execution-expiry loop
    ([periodic.go:216](../../../server/cmd/control/periodic.go)) ticks, then it
    runs under `TryWithAdvisoryLock` so **exactly one** replica emits
    `ExecutionTimedOut` for a given stale execution per tick (the retention,
    inventory, and dynamic-group workers already do this; this closes the
    fourth).
16. Given an OIDC authorization-code flow started on replica A and completed on
    replica B, when the callback is handled, then the flow succeeds: the
    `state`/PKCE verifier is carried in a signed cookie or shared store, never
    replica-local memory (asserted by test).

## Out of scope

- **Per-gateway pre-issued tokens or manual enroll approval.** Decided:
  single rotatable shared bootstrap token, auto-approve on valid token.
- **Persisted gateway identity.** Decided: ephemeral per-boot. A gateway's
  `gateway_id` lives with the process; a restart re-enrolls and gets a new id.
  (Renewal, Part B, keeps the id stable *within* a process's life.)
- **Control-instance enrollment / individual control identity.** Control
  replicas are fungible; giving them individual certs buys little (they share
  the CA key). The enroll RPC is designed generically enough that control
  *could* enroll later, but this spec does not require or build it.
- **Leader election.** Not needed: advisory-lock single-flighting already
  covers periodic work (AC 15). Explicitly rejected as unnecessary.
- **Datastore auth hardening** (Valkey ACL/TLS, Postgres role-split/TLS): see
  spec 32; Part D of *that* spec reuses this spec's CA-issued identities for
  mTLS to the datastores.
- **A configuration knob for the enroll rate-limit.** The gateway cert TTL is
  fixed at 45 days (AC 7).
- **A static-cert escape hatch.** The `--tls-cert`/`--tls-key` flags are
  **removed** (AC 6); enrollment is the only identity path. An air-gapped
  deployment must run its own control reachable by its gateways; there is no
  operator-managed-cert fallback (deliberate clean break).

## Technical design

### Affected repos (cross-repo order: sdk → server → agent → web)

**sdk** (`sdk/proto/pm/v1/`):
- New `gateway_auth.proto` → `service GatewayAuthService { rpc EnrollGateway(...) }`
  (public, no mTLS; mirrors `ControlService.Register`).
  - `EnrollGatewayRequest{ token=1 [validate:"required,max=512"], hostname=2
    [validate:"omitempty,hostname_rfc1123,max=253"], csr=3
    [validate:"required"] }`
  - `EnrollGatewayResponse{ ca_cert=1, certificate=2 }`: no `gateway_id`
    field; the id lives in the cert `CN` (AC 1), the single source of truth.
- `internal.proto` → `rpc RenewGatewayCertificate(RenewGatewayCertificateRequest)
  returns (RenewGatewayCertificateResponse)` on `InternalService` (the existing
  gateway↔control mTLS plane).
  - `RenewGatewayCertificateRequest{ csr=1 [validate:"required"] }`: the
    current cert is the mTLS peer cert; `gateway_id` is read from its `CN`.
  - `RenewGatewayCertificateResponse{ certificate=1 }`
- `control.proto` → `rpc GetCertificateRevocationList(...)` and
  `rpc RevokeGatewayCertificate(...)` on `ControlService`.
  - `GetCertificateRevocationListRequest{}` →
    `GetCertificateRevocationListResponse{ revoked_fingerprints=1 (repeated
    string), not_after=2, refreshed_at=3 }` (rate-limited; agent-facing).
  - `RevokeGatewayCertificateRequest{ gateway_id=1 [validate:"required,ulid"] }`
    → `RevokeGatewayCertificateResponse{}` (permission-gated).

**server**:
- `internal/ca/ca.go`: parameterize the SAN class **and** the validity.
  `IssueCertificateFromCSR(id string, csrPEM []byte, class mtls.PeerClass,
  validity time.Duration)` (or a thin `IssueGatewayCertificateFromCSR` wrapper)
  branching [ca.go:166](../../../server/internal/ca/ca.go) between
  `PeerClassAgent` and `PeerClassGateway`. `CN`/`SerialNumber` = the passed id.
  Gateway certs use a fixed **45-day** validity (short-lived per AC 7), distinct
  from the agent `ca.validity`. Migrate the one existing agent call site.
- `internal/api/gateway_auth_handler.go` (new). `EnrollGateway`: constant-time
  token compare (`crypto/subtle`) vs `cfg.GatewayEnrollToken`; `ulid.Make()`
  gateway_id; `ca.IssueCertificateFromCSR(id, csr, PeerClassGateway)`; append
  `GatewayEnrolled`. New rate limiter `EnrollGateway: NewRateLimiter(5,
  time.Minute)` in the `RateLimiters` bundle, plus an interceptor allow-list
  entry and a public-procedure exemption (no JWT).
- `internal/handler` (internal plane). `RenewGatewayCertificate`: extract
  `gateway_id` from the mTLS peer cert `CN`
  (`mtls.DeviceIDFromTLS`/generalized), verify `PeerClassGateway` +
  not-revoked, `AssertCSRMatchesCertKey`, re-sign same id, `crl.Revoke(oldFP,
  oldNotAfter)`, append `GatewayCertRenewed`.
- `internal/api/certificate_handler.go` or a sibling: `GetCertificateRevocationList`
  returns `crl.Store.LoadActive()` + freshness; `RevokeGatewayCertificate`
  looks up the fingerprint by `gateway_id` from `gateways_projection`, calls
  `crl.Revoke`, appends `GatewayRevoked`. Permission constant
  `gateway:revoke` + RBAC mapping + `apiError` code.
- `internal/gateway/registry/binding.go`: `CheckDeviceGatewayBinding` signature
  takes the **authenticated** gateway_id (peer-cert `CN`); the two callers
  (`InternalService` handlers, `control:inbox` worker) supply it from the mTLS
  conn / event provenance rather than the request body. Update the stale
  doc-comment.
- `internal/store`: typed payloads + projector appliers for `GatewayEnrolled`,
  `GatewayCertRenewed`, `GatewayRevoked` (stream type `gateway`, stream id =
  `gateway_id`); migration adding `gateways_projection`
  (`gateway_id`, `fingerprint`, `hostname`, `not_after`, `revoked_at`,
  `enrolled_at`); sqlc queries `ListGateways`, `GetGatewayFingerprint`. Follow
  the Go-projector pattern (pure applier + `Listener` + `WireAll`); **not** in
  `AllRebuildTargets` if replay is intentionally excluded (ephemeral rows).
  Decide during impl and log the choice.
- `cmd/control`: `cfg.GatewayEnrollToken` +
  `config.EnvString(&cfg.GatewayEnrollToken, "CONTROL_GATEWAY_ENROLL_TOKEN")`;
  boot-validate (non-empty, min length) when enrollment is enabled; mount
  `GatewayAuthService` on the public listener; wire the new rate limiter.
- `cmd/control/periodic.go`: wrap `startStaleExecutionExpiry`'s cycle in
  `st.TryWithAdvisoryLock(ctx, advisoryKeyStaleExpiry, fn)` (new
  `advisoryKeyStaleExpiry int64` constant), matching the retention/inventory
  workers; log `"…skipped — another replica holds the lock"` on contention.
- `cmd/gateway/main.go`: the `--tls-cert`/`--tls-key` flags are **deleted**.
  Boot always enrolls: generate keypair → CSR → `EnrollGateway` (with
  `GATEWAY_ENROLL_TOKEN`) → hold cert in memory → build `mtls.NewTLSConfig` from
  it for the agent-facing server and the control client; a renewal goroutine at
  80% lifetime via `RenewGatewayCertificate`. `gateway_id` (for the registry /
  Traefik keys / binding) is parsed from the issued cert's `CN`. A gateway that
  observes its own cert **revoked** (control-plane 403 / renewal denial) halts
  and alerts; it does **not** re-enroll (AC 10b).

**agent** (separate module, own PR):
- A gateway-CRL client: poll `ControlService.GetCertificateRevocationList` over
  the CA-pinned control channel on a cadence (≤ ½ the freshness window), cache
  with a `Loaded()` + `not_after` freshness gate, and on each gateway
  connection check the gateway server-cert fingerprint
  (`ca.FingerprintFromCert`) against it. **Fail closed** when the cache is
  unloaded or stale, or the fingerprint is revoked, and reject the gateway.
  Mirror the gateway's own `loadInitialCRL` fail-closed boot posture.

**web** (direct-to-main):
- A minimal **Gateways** view: list from `ListGateways` (`gateway_id`,
  `hostname`, `enrolled_at`, revoked state) with a **Revoke** action calling
  `RevokeGatewayCertificate`, gated behind the `gateway:revoke` permission and
  routed through `getLocalizedError`.

### Database changes

- New event types `GatewayEnrolled`, `GatewayCertRenewed`, `GatewayRevoked`
  (typed payloads; `fingerprint` and `hostname` are not secrets, no key
  material logged or stored).
- New `gateways_projection` table. Ephemeral-per-boot means rows accumulate one
  per enrollment; a row is *live* until its `not_after` passes or it is revoked.
  A retention sweep (or a `WHERE not_after > now()` filter on `ListGateways`)
  keeps the operator view bounded. **Decision point:** filter-on-read
  (simplest) vs a periodic prune. Default: filter-on-read; revisit if the
  projection grows unbounded under heavy churn.

### New dependencies

None. Everything reuses `internal/ca`, `internal/crl`, `internal/mtls`,
`internal/auth` (rate limiter), and the projector/advisory-lock patterns.

## Security considerations

- **Authorization / trust boundary.** `EnrollGateway` is public and gated
  **solely** by the shared bootstrap token, so the token is a high-value
  secret. Mitigations: constant-time compare, 5/min/IP rate limit, a cert that
  can *only* act as a gateway (class-scoped, still confined by the origin
  binding), and operator rotation via `CONTROL_GATEWAY_ENROLL_TOKEN` +
  restart. `RevokeGatewayCertificate` requires the `gateway:revoke` permission
  and is audit-logged.
- **Ephemeral-identity revocation model.** Because identity is per-boot,
  "revoke this gateway forever" composes four controls. (a) CRL-revoke the
  *live* cert fingerprint, enforced on **both** the control-facing plane
  (WS12) and the agent-facing plane (Part D). (b) The revoked gateway's own
  client **must not re-enroll**: on seeing its cert rejected as revoked it
  halts rather than minting a fresh identity with the still-held token
  (AC 10b). (c) Against a *compromised* host that ignores (b), **rotate
  `CONTROL_GATEWAY_ENROLL_TOKEN`**, since a shared token is the sole enrollment
  authority, so a still-valid token otherwise lets the attacker enroll a new,
  distinct `gateway_id` (the inherent cost of shared-token + auto-approve, made
  explicit). (d) The **45-day** TTL bounds any gateway whose revocation is not
  actively enforced. This is the honest limit of the chosen model: (a)+(b)
  handle an honest decommission and cut off a compromised gateway's *current*
  identity immediately; (c) is required to durably lock out a host that still
  holds the token.
- **Agent-side CRL authenticity & freshness.** The agent fetches the CRL over a
  **CA-pinned TLS** channel *directly to control* (the same reachability
  `Register`/`RenewCertificate` already require), so the transport authenticates
  the CRL: no payload signature and no gateway relay (a compromised gateway
  cannot feed the agent a doctored CRL). A gateway withholding refreshes cannot
  hide a revocation because the agent **fails closed on staleness** (AC 12).
  *Reachability assumption* (documented): agents can reach control directly; a
  control-isolated topology would need a control-signed, gateway-relayed CRL,
  noted as a future option, not built here.
- **Input validation.** `token`, `hostname`, `csr` validated at the proto
  boundary (`@gotags validate`) and the handler; the CA rejects caller SANs and
  verifies the CSR self-signature and proof-of-possession.
- **Audit.** Enroll, renew, and revoke are all events, so all are audit-logged.
- **Control HA secrets.** All shared crypto material stays in config and is
  identical across replicas; no key is minted per-replica. The task-HMAC
  (spec 29) already assumes a shared key across the fan-out.
- **No `context.Background()` in the enroll/renew/CRL request paths**; ULIDs
  for `gateway_id`; `crypto/rand` for all key/serial material (via the existing
  CA).

## Test requirements

### Handler tests (real Postgres, real handlers)

- `EnrollGateway`: correct (valid token + CSR → cert with `CN=gateway_id`, class
  SAN, `GatewayEnrolled` appended; response carries **no** `gateway_id` field,
  id read from the cert `CN`); absent/wrong/malformed token → `PermissionDenied`
  **and a WARN log carrying the requester IP + hostname + token-hash prefix**
  (AC 3), asserted via a captured `slog` handler; CSR-with-SAN → rejected;
  malformed CSR → `InvalidArgument`; 6th call in a minute → `ResourceExhausted`;
  constant-time compare exercised (no early-return timing branch on token
  prefix).
- `RenewGatewayCertificate`: valid current cert → new cert same `gateway_id` +
  old fingerprint revoked + `GatewayCertRenewed`; revoked current cert →
  rejected; non-gateway class → rejected; PoP failure → rejected.
- `RevokeGatewayCertificate`: authorized → fingerprint in CRL +
  `GatewayRevoked`; missing permission → `PermissionDenied`; unknown
  `gateway_id` → `NotFound`.
- `GetCertificateRevocationList`: returns active fingerprints + freshness;
  rate-limited.
- Binding: `CheckDeviceGatewayBinding` uses the peer-cert `CN` (a request-body
  `gateway_id` that disagrees with the cert is ignored / cannot escalate);
  mismatch → `PermissionDenied`; not-live → `FailedPrecondition`; nil lookup →
  allow (single-gateway exception).

### Integration tests

- **End-to-end enroll**: gateway boot (no static cert) → enroll → serves
  agent-facing mTLS with the issued cert; an agent connects and is accepted.
- **Agent-side revocation** (net-new, the highest-value test): agent connected
  to gateway G; operator revokes G; agent refuses G on next
  connection/refresh; agent with a **stale** CRL cache **fails closed** (rejects
  G) rather than trusting it.
- **No re-enroll after revocation** (AC 10b/c): a revoked gateway whose cert is
  rejected halts and does **not** call `EnrollGateway` (assert no second
  `GatewayEnrolled` from that process); and after `CONTROL_GATEWAY_ENROLL_TOKEN`
  rotation, an enroll attempt with the old token → `PermissionDenied` (the
  compromised-host backstop).
- **Control HA**: two control instances over one Postgres. The
  stale-execution-expiry loop emits `ExecutionTimedOut` **once** (advisory-lock
  single-flight); both replicas project a shared event exactly once; an OIDC
  flow started on A completes on B.

### Property / generative

- Token compare is constant-time across mismatched-length and
  shared-prefix inputs (no timing oracle).

## Rejection paths

| Scenario | Error code | Client message | Logged context |
|---|---|---|---|
| Absent / wrong / malformed enroll token | PermissionDenied | "invalid enrollment token" | client IP, token hash prefix (never the token) |
| CSR requests a SAN | InvalidArgument | "CSR must not request subject alternative names" | client IP |
| Malformed / unverifiable CSR | InvalidArgument | "invalid certificate signing request" | client IP |
| > 5 enroll attempts/min/IP | ResourceExhausted | "too many enrollment attempts" | client IP |
| Renew with revoked / non-gateway / PoP-fail cert | PermissionDenied | "certificate renewal denied" | gateway_id (from cert), reason |
| `RevokeGatewayCertificate` without permission | PermissionDenied | "permission denied" | actor, gateway_id |
| `RevokeGatewayCertificate` unknown gateway | NotFound | "gateway not found" | actor, gateway_id |
| Agent: gateway cert revoked | (agent-side) refuse connection | — | gateway_id, fingerprint |
| Agent: CRL cache stale/unloaded | (agent-side, fail-closed) refuse connection | — | last_refresh, staleness |

## Rollout and migration

- **Breaking (deliberate clean break).** The static `--tls-cert`/`--tls-key`
  path is **removed**; every gateway must enroll. Existing deployments must add
  `GATEWAY_ENROLL_TOKEN` and let the gateway self-enroll on next start; a gateway
  with no reachable control or valid token will not boot. Called out in the
  gateway release notes as a required migration step.
- **Deploy sequencing:** sdk (proto) → server (CA branch, handlers, HA lock) →
  agent (CRL client) → web (Gateways view). `CONTROL_GATEWAY_ENROLL_TOKEN`
  added to `setup.sh` (guided-generate `openssl rand -base64 32`) and
  `compose.yml`; `setup.sh` **stops generating the gateway cert** (there is no
  static cert to mount); gateway service gets `GATEWAY_ENROLL_TOKEN`.
- **Agent compatibility:** the agent-side CRL check is net-new; an old agent
  that does not yet fetch the CRL keeps working against the control-facing
  revocation plane (no regression), but does not honor agent-facing revocation
  until upgraded. Call this out in the agent release notes.
- **Control HA:** the advisory-lock fix is safe to deploy standalone (a single
  instance sees no behavior change; it just takes a lock it never contends).

## References

- ADR-0005 (gateway↔control device-origin binding), WS12 (CRL fail-closed).
- The `ControlService.Register` enrollment path
  ([registration_handler.go](../../../server/internal/api/registration_handler.go)):
  token/rate-limit/CSR-sign machinery this spec reuses.
- The reused primitives: `ca.IssueCertificateFromCSR`, `mtls.PeerClassURI`,
  `crl.Store`/`crl.Cache`, `store.TryWithAdvisoryLock`.
- spec 29 (task-HMAC, compensating control for a Valkey compromise); spec 32
  (datastore auth hardening, reuses this spec's per-component identities).
- New ADRs to write on approval: **ADR gateway enrollment** (shared-token /
  auto-approve / ephemeral rationale + agent-side CRL model) and **ADR control
  HA** (advisory-lock singleton model; why no leader election).
