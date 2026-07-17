---
title: "Gateway self-enrollment and control-plane HA"
status: draft
created: 2026-07-12
---

# Gateway self-enrollment and control-plane HA

## Overview

At the reviewed source revision, gateway boot already self-enrolls with a
per-gateway ULID in the certificate CN/subject serial, a gateway-class URI SAN,
one agent-facing DNS SAN, and ClientAuth/ServerAuth EKUs. The same certificate
serves agents and authenticates the Gateway to Control; synchronous
`InternalService` binding already derives instance identity from the authenticated
peer CN. Agents already fetch the gateway CRL and enforce it on new TLS
handshakes, and `ListGateways` already uses heartbeat-registry liveness with a
certificate-valid fallback when liveness is unavailable. These are existing
regression requirements, not unimplemented migration steps.

This spec completes and hardens the **enroll → per-identity cert → renew →
revoke** lifecycle. Control, not a bootstrap-token holder, owns the certificate's
server-name authority by deriving the sole DNS SAN from the configured
`CONTROL_GATEWAY_URL`; the enrollment hostname is only an exact consistency
assertion. The remaining work makes Control authoritative for the DNS SAN, removes the
invalid-token hash-prefix log, classifies asynchronous binding retries correctly,
terminates an already-established agent session when its peer becomes revoked or
revocation state expires, and closes any missing deployment-level proofs. Existing
enrollment, renewal, revocation, peer-CN binding, liveness, CRL, projector, and HA
behavior remains mandatory regression coverage.

The reviewed source also already implements the **multi-instance control** model:
control replicas are fungible (they share the CA key, JWT secret, encryption key,
and task-signing key, all externalized config) behind a load balancer over shared
Postgres + Valkey. Periodic workers, including stale-execution expiry, single-flight
on Postgres advisory locks, and OIDC flow state is stored in shared PostgreSQL.
This spec preserves those properties and requires final multi-replica deployment
proof rather than introducing a leader-election system.

## Motivation

- **Enrollment authority is broader than server-name authority should be.** The
  current handler stamps the caller-supplied hostname into the DNS SAN. A holder
  of the fleet bootstrap token can therefore request another syntactically valid
  gateway name, while an accepted IP literal is placed in `DNSNames` and cannot
  satisfy Go's IP-address verification. Control must derive and stamp the exact
  canonical DNS host from `CONTROL_GATEWAY_URL` and reject any unequal or IP
  enrollment claim.
- **Synchronous identity is already certificate-bound; asynchronous provenance
  still needs precise failure semantics.** Synchronous InternalService binding
  reads the authenticated peer CN. Inbox tasks have no peer connection and retain
  their fleet-HMAC + claimed-ID + registry-check provenance; permanent binding
  failures must drop, while transient registry failures must retry instead of
  being archived.
- **Handshake-only revocation does not terminate an established session.** The
  agent already rejects revoked gateways during new TLS handshakes, but a CRL
  refresh does not cancel the currently connected stream. This spec makes current
  peer revocation and CRL expiry terminate the live session before another gateway
  message is processed.
- **Multi-instance control exists but still needs deployment proof.** Shared
  crypto configuration, synchronous projectors, advisory-locked periodic work,
  and PostgreSQL-backed OIDC flow state already make replicas fungible. The
  remaining requirement is to keep those source-level guards and prove the real
  multi-replica deployment path end to end.

Related: [ADR-0005 (gateway↔control device-origin binding)], WS12 (CRL
fail-closed), spec 29 (task-HMAC, the *compensating* control that assumes a
Valkey compromise; this spec hardens *identity*, spec 32 hardens datastore
auth).

## Acceptance criteria

Numbered, testable. Grouped by part.

### Part A: Gateway self-enrollment

1. Given a gateway configured with the valid shared `PM_GATEWAY_ENROLL_TOKEN`,
   the canonical DNS hostname from its production agent URL, and a PEM PKCS#10
   CSR, when it calls `GatewayAuthService.EnrollGateway`, then Control validates
   the token in **constant time**, derives the authoritative expected DNS hostname
   from its validated `CONTROL_GATEWAY_URL`, requires the request hostname to
   equal that lowercase trailing-dot-free DNS name exactly, rejects IP literals,
   assigns a fresh ULID `gateway_id`, and signs the CSR with `CN = SerialNumber =
   gateway_id`, the class URI SAN `spiffe://power-manage/gateway`, exactly that one
   Control-derived DNS SAN, and both ClientAuth and ServerAuth EKUs. The response
   is `{ca_cert, certificate}` and carries no separate `gateway_id`: the cert CN is
   the single instance-identity authority, while the DNS SAN is the standard-TLS
   server-name authority used by agents.
2. Given an `EnrollGateway` CSR that requests any SAN (DNS/IP/email/URI), when
   it is processed, then it is rejected: the CA stamps the class URI and DNS SANs
   itself and refuses caller-supplied SANs (existing
   `IssueCertificateFromCSR` behavior).
3. Given an `EnrollGateway` call with an absent or oversized token, when request
   validation runs, then it returns `InvalidArgument` before token comparison,
   allocates no `gateway_id`, and emits no event. Given a schema-valid but
   nonmatching token, then the handler returns `PermissionDenied` ("invalid
   enrollment token"), allocates no ID, emits no event, and writes a WARN with
   requester IP, supplied hostname, and a fixed reason category. No token or
   token-derived value, including a hash prefix, is logged.
4. Given more than **5 `EnrollGateway` attempts per minute from one client IP**,
   when the 6th arrives, then it is rejected `ResourceExhausted` (the
   `Register`/`RenewCert` rate-limiter pattern, keyed by client IP).
5. Given a successful enrollment, when it commits, then a `GatewayEnrolled`
   event is appended (`gateway_id`, cert **fingerprint**, `not_after`,
   `hostname`), projected into `gateways_projection`, and audit-visible: the
   fingerprint↦gateway_id mapping revocation needs.
6. Given a gateway, when it boots, then the existing enrollment-only identity
   path remains the **only** way it obtains its cert: static
   `--tls-cert`/`--tls-key` flags remain absent, with no compatibility fallback.
   It requires the production hostname used by
   agents, generates a keypair (private key never leaves the process), submits a
   SAN-free CSR plus that hostname, verifies the returned cert's CN, DNS SAN, peer
   class, and ClientAuth/ServerAuth EKUs, and uses it for both the agent-facing
   mTLS server and control-facing client. Its `gateway_id` is read from the cert
   CN, not config. No reachable control, invalid token, absent hostname, or wrong
   returned profile prevents startup; there is no fallback identity.

### Part B: Gateway certificate renewal

7. Given a gateway cert issued with a **45-day** validity (short-lived,
   mirroring the planned short-TTL public-certificate posture), when the gateway
   reaches ≥80% of that lifetime (~36 days), then it calls
   `InternalService.RenewGatewayCertificate` over the control-facing mTLS plane
   presenting its current (valid, non-revoked) gateway cert; control re-signs a
   new cert with the **same** `gateway_id`, exact single DNS SAN, class URI SAN,
   and ClientAuth/ServerAuth EKUs, revokes the superseded fingerprint into the
   CRL, emits `GatewayCertRenewed`, and the gateway swaps the cert without
   dropping agent connections. A current cert with an absent, multiple, or
   non-canonical DNS SAN is rejected for renewal and requires explicit
   re-enrollment; control never issues a renewed cert that standard agent TLS
   cannot verify. A revoked or abandoned gateway cert additionally
   **self-expires within 45 days** even if the CRL is unavailable.
8. Given a `RenewGatewayCertificate` call whose presented cert is revoked, not
   `PeerClassGateway`, or fails proof-of-possession against the new CSR, when
   validated, then it is rejected and no new cert is issued.

### Part C: Synchronous origin binding and asynchronous provenance

9. Given a synchronous `InternalService` request, when Control applies the
   device→gateway binding check, then `gateway_id` is read from the authenticated
   peer-certificate CN, every request-body `gateway_id` authority is removed or
   ignored, and the identity is cross-checked against the routing registry
   (mismatch → `PermissionDenied`; device not live → `FailedPrecondition`; runtime
   lookup/access failure → retryable `Unavailable`; absent registry is a
   startup/configuration failure).
   Given a `control:inbox` task, no TLS peer exists at consumption time: its
   `gateway_id` remains a claimed payload field inside the queue/type/direction-
   bound `PM_TASK_SIGNING_KEY` HMAC envelope and is then cross-checked against the
   same routing registry. An empty/mismatched/not-live claim is a permanent
   non-retriable drop with no domain effect; a registry backend failure is returned
   as an ordinary retryable worker error and must not be collapsed into
   `asynq.SkipRetry`. This proves fleet-key-authenticated queue provenance, not per-
   gateway certificate provenance; the spec must not describe the inbox value as
   peer-CN-derived.

### Part D: Agent-facing gateway revocation completion

10. Given a revoked gateway, when an operator calls
    `ControlService.RevokeGatewayCertificate(gateway_id)` (permission-gated,
    audit-logged), then (a) that gateway's fingerprint is added to
    `pm:crl:revoked` and a `GatewayRevoked` event is emitted; (b) the revoked
    gateway, once its cert is rejected as revoked (on the control plane or at
    renewal), MUST **halt and alert**: it must NOT fall back to
    `EnrollGateway` to mint itself a fresh identity with the still-held
    bootstrap token; and (c) durable revocation against a *compromised* host
    (which will ignore (b)) is completed by rotating
    `PM_GATEWAY_ENROLL_TOKEN`, since a still-valid shared token otherwise
    permits a new, distinct `gateway_id` to enroll. The 45-day TTL (AC 7) bounds
    the window if neither (a) nor (c) is applied.
11. Given an agent, when it connects to a gateway, then it verifies the gateway's
    **server-cert fingerprint** against a fresh control-sourced CRL and refuses
    the connection if revoked. After handshake it records that peer fingerprint;
    if a later CRL refresh marks it revoked, or the cached CRL expires while the
    session remains active, the agent cancels the current session before
    processing another gateway message and refuses reconnection until the CRL gate
    passes.
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
    ([periodic.go:216](../../../server/cmd/control/periodic.go)) ticks, then its
    existing `TryWithAdvisoryLock` guard ensures **exactly one** replica emits
    `ExecutionTimedOut` for a given stale execution per tick.
16. Given an OIDC authorization-code flow started on replica A and completed on
    replica B, when the callback is handled, then the flow succeeds because the
    state, nonce, PKCE verifier, and redirect URI remain in shared PostgreSQL,
    never replica-local memory.

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
- **Per-gateway cryptographic signatures on asynchronous inbox tasks.** The queue
  envelope remains protected by the fleet-shared, queue/type/direction-bound
  `PM_TASK_SIGNING_KEY`; the claimed `gateway_id` is registry-checked but is not a
  peer-certificate identity. Stronger per-gateway queue attribution requires a
  separate design and key-distribution contract.
- **A configuration knob for the enroll rate-limit.** The gateway cert TTL is
  fixed at 45 days (AC 7).
- **A static-cert escape hatch.** The already-removed `--tls-cert`/`--tls-key`
  flags stay absent (AC 6); enrollment is the only identity path. An air-gapped
  deployment must run its own control reachable by its gateways; there is no
  operator-managed-cert fallback (deliberate clean break).

## Technical design

### Required ADR reconciliation

Before implementation, write a superseding ADR that reconciles the accepted trust
records with the production certificate model this spec deliberately adopts:

- ADR-0005's request-body `gateway_id` authority and nil/single-gateway bypass are
  replaced by peer-CN instance identity for synchronous calls and fleet-HMAC
  claimed identity for asynchronous inbox tasks, with a mandatory registry.
- ADR-0025's SPIFFE URI SAN remains the peer-**class** authority; the gateway ULID
  in CN/subject serial is a separate per-instance binding authority and the DNS SAN
  is only standard TLS server-name authority. This is not a return to CN/DNS-only
  peer-class authentication.
- The current deployment uses one CA/key for agent and gateway certificate
  issuance and action signing, including the dual-use gateway leaf required by
  standard agent TLS. ADR-0025's asserted three-authority separation is not the
  current implementation and must not remain marked as the operative decision
  unless a separately specified trust-bundle/key-distribution migration actually
  implements it. The superseding ADR records the accepted blast-radius trade-off
  and preserves domain-separated action signatures.

### Affected repos (cross-repo order: sdk → server → agent → web)

**sdk** (`sdk/proto/pm/v1/`):
- Existing `gateway_auth.proto` keeps `GatewayAuthService.EnrollGateway` public and
  self-authenticating outside the JWT interceptor.
  - `EnrollGatewayRequest{ token=1 [validate:"required,max=512"], hostname=2
    [validate:"required,hostname_rfc1123,max=253"], csr=3
    [validate:"required"] }`. The broad generated hostname check is followed by
    handler-level parsing and exact equality with the canonical DNS host derived
    from `CONTROL_GATEWAY_URL`; IP literals and valid-but-unlisted DNS names reject.
  - `EnrollGatewayResponse{ ca_cert=1, certificate=2 }`: no `gateway_id`
    field; identity lives in the cert CN. Control stamps its configured hostname,
    not caller-chosen authority, as the sole DNS SAN. The cert also carries the
    gateway class URI SAN and both ClientAuth/ServerAuth EKUs (AC 1).
- `internal.proto` retains
  `rpc RenewGatewayCertificate(RenewGatewayCertificateRequest) returns
  (RenewGatewayCertificateResponse)` on the existing gateway↔control mTLS plane.
  - `RenewGatewayCertificateRequest{ csr=1 [validate:"required"] }`: the
    current cert is the mTLS peer cert; `gateway_id` is read from its `CN`.
  - `RenewGatewayCertificateResponse{ certificate=1, not_after=2 }`; the renewed
    certificate preserves the current cert's exact single DNS SAN and gateway
    class/EKU profile. Missing/multiple/non-canonical DNS SANs fail closed.
- `control.proto` retains `GetCertificateRevocationList` and
  `RevokeGatewayCertificate` on `ControlService`.
  - `GetCertificateRevocationListRequest{}` →
    `GetCertificateRevocationListResponse{ revoked_fingerprints=1 (repeated
    string), not_after=2, refreshed_at=3 }` (rate-limited; agent-facing).
  - `RevokeGatewayCertificateRequest{ gateway_id=1 [validate:"required,ulid"] }`
    → `RevokeGatewayCertificateResponse{}` (permission-gated).

**server**:
- `internal/ca/ca.go`: keep the shared CSR parser/signature/SAN-rejection path and
  a thin `IssueGatewayCertificateFromCSR(id, csr, hostname)` profile. The server,
  never the CSR, stamps `CN`/subject serial = id, the gateway class URI SAN,
  exactly one validated DNS SAN, ClientAuth + ServerAuth EKUs, and the fixed
  **45-day** validity. Agent issuance remains client-only with the agent class and
  existing validity. Renewal must reject rather than drop an absent/multiple/
  non-canonical current DNS SAN.
- `internal/api/gateway_auth_handler.go`: retain the constant-time token compare
  (`crypto/subtle`) vs `cfg.GatewayEnrollToken`, but remove the token-hash-prefix
  log. Parse the already startup-validated `cfg.GatewayURL`, derive its sole
  lowercase trailing-dot-free DNS host, reject IP hosts, and require the request
  hostname to equal it exactly before `ulid.Make()` or issuance. Pass only that
  configured hostname to `ca.IssueGatewayCertificateFromCSR`, verify the returned
  profile, then append `GatewayEnrolled`. Keep the handler's own
  `NewRateLimiter(5, time.Minute)`. It remains outside `auth.PublicProcedures`,
  whose exact parity guard is ControlService-only; mount/auth catalog tests record
  the self-authenticating public `GatewayAuthService` source explicitly.
- `internal/api` (`InternalHandler`, internal plane).
  `RenewGatewayCertificate`: extract `gateway_id` from the authenticated peer
  cert CN, verify `PeerClassGateway` + not-revoked, `AssertCSRMatchesCertKey`,
  require exactly one canonical current DNS SAN, re-sign the same id/profile,
  append `GatewayCertRenewed`, and revoke the superseded fingerprint. A missing
  DNS SAN is an error, not a warn-and-issue path.
- `internal/api/certificate_handler.go` or a sibling: `GetCertificateRevocationList`
  returns `crl.Store.LoadActive()` + freshness; `RevokeGatewayCertificate`
  looks up the fingerprint by `gateway_id` from `gateways_projection`, calls
  `crl.Revoke`, appends `GatewayRevoked`. Permission constant
  `gateway:revoke` + RBAC mapping + `apiError` code.
- `internal/gateway/registry/binding.go`: `CheckDeviceGatewayBinding` accepts a
  caller-supplied identity plus its source-specific trust proof. Synchronous
  `InternalService` handlers supply the authenticated peer-cert CN and remove/
  ignore request-body identity. The asynchronous `control:inbox` worker has no
  peer connection: after mandatory task-HMAC middleware verifies the exact
  queue/type/direction/payload envelope, it supplies the payload's claimed
  `gateway_id` and registry-checks it. Update comments/tests so the latter is not
  mislabeled peer-cert provenance. The worker maps only permanent binding sentinels
  (missing claim, not live, mismatch) to `asynq.SkipRetry`; an underlying registry
  lookup failure remains an ordinary retryable error. Production startup requires
  the registry; remove the nil/single-gateway allow bypass from both paths.
- `internal/store`: retain the existing typed `GatewayEnrolled`,
  `GatewayCertRenewed`, and `GatewayRevoked` payloads/projectors, the
  `gateways_projection` schema (`gateway_id`, `fingerprint`, `hostname`,
  `not_after`, `revoked_at`, `enrolled_at`), and its generated queries. Preserve
  the current Go-projector wiring and schema-classification/rebuild decision as
  regression requirements; do not add a duplicate migration or second read model.
- `cmd/control`: keep `cfg.GatewayEnrollToken` sourced from the existing shared
  `PM_GATEWAY_ENROLL_TOKEN`; boot-validate its minimum strength when enrollment is
  enabled. Pass the validated `CONTROL_GATEWAY_URL` to the enrollment handler as
  server-name authority, retain the separately mounted public
  `GatewayAuthService`, and retain its rate limiter.
- `cmd/control/periodic.go`: retain `startStaleExecutionExpiry`'s existing
  `TryWithAdvisoryLock(ctx, advisoryKeyStaleExpiry, fn)` single-flight and its
  contention logging; the HA test is a regression gate, not new implementation.
- `cmd/gateway/main.go`: retain the existing self-enrollment-only boot path and
  deleted static-cert flags. Boot derives the production hostname from its
  configured agent-facing URL, sends it as an exact consistency assertion with
  `PM_GATEWAY_ENROLL_TOKEN` and a SAN-free CSR, validates the returned
  CN/DNS-SAN/class/EKUs, and uses that certificate for both listener and Control
  client. Retain the existing 80%-lifetime renewal via
  `RenewGatewayCertificate`, tightening the exact DNS-SAN/profile rejection paths
  above. `gateway_id` remains parsed from the cert CN. A gateway that observes its own cert **revoked**
  (control-plane 403 / renewal denial) halts and alerts; it does **not** re-enroll
  (AC 10b).

**agent** (separate module, own PR):
- Extend the existing gateway-CRL cache and per-handshake check. After each
  successful gateway handshake, retain the authenticated leaf fingerprint for the
  session. A successful refresh that newly revokes that fingerprint, or passage of
  the cache's `not_after` without refresh, cancels the session context before the
  receive loop handles another gateway message. **Fail closed** while unloaded,
  stale, or revoked and refuse reconnect until `Check` passes. Keep CRL fetches on
  the CA-pinned direct Control channel.

**web** (direct-to-main):
- Retain the existing **Gateways** view, `ListGateways` fields, permission-gated
  **Revoke** action, and `getLocalizedError` path as regression coverage; no
  duplicate operator surface is added by the remaining hardening.

### Database changes

None for the remaining hardening. Retain the existing typed `GatewayEnrolled`,
`GatewayCertRenewed`, and `GatewayRevoked` events and `gateways_projection`.
`ListGateways` continues to combine certificate-valid rows with registry liveness,
using its existing certificate-valid fallback when liveness is unavailable. No
second projection, duplicate event type, or speculative prune loop is added.

### New dependencies

None. Everything reuses `internal/ca`, `internal/crl`, `internal/mtls`,
`internal/auth` (rate limiter), and the projector/advisory-lock patterns.

## Security considerations

- **Authorization / trust boundary.** `EnrollGateway` is public and gated
  **solely** by the shared `PM_GATEWAY_ENROLL_TOKEN`, so the token is a high-value
  secret. Mitigations: constant-time compare, no token-derived logs, 5/min/IP rate
  limit, exact equality with the Control-configured gateway DNS host, a cert that
  can *only* act as a gateway (class-scoped, still confined by origin binding),
  and operator token rotation plus restart of both Control and Gateway consumers.
  `RevokeGatewayCertificate` requires the `gateway:revoke` permission and is
  audit-logged.
- **Ephemeral-identity revocation model.** Because identity is per-boot,
  "revoke this gateway forever" composes four controls. (a) CRL-revoke the
  *live* cert fingerprint, enforced on **both** the control-facing plane
  (WS12) and the agent-facing plane (Part D). (b) The revoked gateway's own
  client **must not re-enroll**: on seeing its cert rejected as revoked it
  halts rather than minting a fresh identity with the still-held token
  (AC 10b). (c) Against a *compromised* host that ignores (b), **rotate
  `PM_GATEWAY_ENROLL_TOKEN`**, since a shared token is the sole enrollment
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
- **Synchronous versus asynchronous provenance.** InternalService operations use
  the unique peer-cert CN. Inbox tasks cannot: they are authenticated only by the
  fleet-shared, queue/type/direction-bound task HMAC, then the claimed gateway ID
  is checked against live routing. A compromised holder of the fleet task key is
  therefore inside the asynchronous provenance trust boundary; this spec does not
  falsely claim per-gateway attribution for queued events.
- **Input validation.** `token`, required canonical `hostname`, and `csr` are
  validated at the proto boundary (`@gotags validate`) and handler. The CA rejects
  caller SANs, verifies the CSR self-signature/proof-of-possession, and stamps the
  DNS/class/EKU profile itself. Renewal validates the retained DNS SAN before
  issuing.
- **Audit.** Enroll, renew, and revoke are all events, so all are audit-logged.
- **Control HA secrets.** All shared crypto material stays in config and is
  identical across replicas; no key is minted per-replica. The task-HMAC
  (spec 29) already assumes a shared key across the fan-out.
- **No `context.Background()` in the enroll/renew/CRL request paths**; ULIDs
  for `gateway_id`; `crypto/rand` for all key/serial material (via the existing
  CA).

## Test requirements

### Handler tests (real Postgres, real handlers)

- `EnrollGateway`: correct (valid shared token + hostname exactly matching the DNS
  host in `CONTROL_GATEWAY_URL` + SAN-free CSR → cert with `CN=gateway_id`, exact
  Control-derived DNS SAN, gateway class URI SAN, ClientAuth + ServerAuth, and
  `GatewayEnrolled`; response carries **no** `gateway_id`, which is read from the
  cert CN). Absent and oversized tokens each return `InvalidArgument` through
  validation with no ID/event; a schema-valid wrong token returns
  `PermissionDenied` and a captured WARN containing requester IP, hostname, and a
  fixed reason but no token-derived field. Separate cases reject absent/malformed
  hostname, IPv4/IPv6 literals, a valid but unlisted DNS hostname, mixed-case or
  trailing-dot drift, CSR-with-SAN, malformed CSR, wrong returned profile, and the
  6th call/minute. Constant-time compare has no prefix early-return branch.
- `RenewGatewayCertificate`: valid current cert → new cert with the same
  `gateway_id`, exact DNS SAN, class URI SAN, and both EKUs + old fingerprint
  revoked + `GatewayCertRenewed`; revoked/non-gateway/PoP-fail current cert and
  absent/multiple/non-canonical current DNS SAN all reject with no issuance.
- `RevokeGatewayCertificate`: authorized → fingerprint in CRL +
  `GatewayRevoked`; missing permission → `PermissionDenied`; unknown
  `gateway_id` → `NotFound`.
- `GetCertificateRevocationList`: returns active fingerprints + freshness;
  rate-limited.
- Synchronous binding: the real InternalService handler uses the peer-cert CN; a
  disagreeing request-body `gateway_id` is ignored/removed, mismatch is
  `PermissionDenied`, not-live is `FailedPrecondition`, a runtime registry
  lookup/access failure is retryable `Unavailable`, and absent registry prevents
  production startup.
- Asynchronous binding: real inbox mux rejects unsigned/tampered/wrong-queue/
  wrong-type HMAC envelopes before JSON, then accepts the payload's claimed
  `gateway_id` only when it matches the registry. Empty, mismatched, and not-live
  claims are non-retriable drops with no event. An injected transient registry
  lookup failure returns an ordinary worker error, is retried, and emits no event
  before a later successful lookup; it is never wrapped in `asynq.SkipRetry`.
  Tests explicitly describe this as fleet-HMAC provenance, not peer-CN identity.

### Integration tests

- **End-to-end enroll/renew**: gateway boot (no static cert) → enroll → serves
  agent-facing mTLS with the issued cert; a standard agent TLS client connects
  using the production SNI and proves the exact DNS SAN + ServerAuth profile,
  while the same cert authenticates as ClientAuth to Control. Renewal preserves
  that profile; missing-DNS-SAN renewal is rejected rather than producing an
  agent-unverifiable cert.
- **Agent-side revocation**: first retain the existing fresh-handshake acceptance
  and revoked-handshake refusal. Then connect the real agent to gateway G without
  forcing a reconnect, revoke G, refresh the CRL, and prove the live session ends
  before another gateway message is processed. A separate injected-clock case
  advances the active session past CRL `not_after`, proves the same cancellation,
  and proves reconnect remains fail-closed until a fresh list loads.
- **No re-enroll after revocation** (AC 10b/c): a revoked gateway whose cert is
  rejected halts and does **not** call `EnrollGateway` (assert no second
  `GatewayEnrolled` from that process); and after `PM_GATEWAY_ENROLL_TOKEN`
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
| Enroll token absent or oversized | InvalidArgument | Existing validation error | client IP and field category; no token-derived data |
| Enroll token is schema-valid but wrong | PermissionDenied | "invalid enrollment token" | client IP, supplied hostname, fixed reason; no token-derived data |
| Hostname absent, non-canonical, an IP literal, or unequal to `CONTROL_GATEWAY_URL` host | InvalidArgument | Existing validation/enrollment error | client IP and field/category; no certificate bytes |
| CSR requests a SAN | InvalidArgument | "CSR must not request subject alternative names" | client IP |
| Malformed / unverifiable CSR | InvalidArgument | "invalid certificate signing request" | client IP |
| Issued cert lacks exact DNS SAN, class SAN, or either required EKU | Gateway startup failure | Gateway refuses the returned identity | Safe profile mismatch category; no certificate bytes |
| > 5 enroll attempts/min/IP | ResourceExhausted | "too many enrollment attempts" | client IP |
| Renew with revoked / non-gateway / PoP-fail cert | PermissionDenied | "certificate renewal denied" | gateway_id (from cert), reason |
| Renewing cert has absent/multiple/non-canonical DNS SAN | InvalidArgument / renewal denied | Re-enrollment required; no new cert | gateway_id and SAN-count/category; no certificate bytes |
| Inbox task is unsigned/tampered or its claimed gateway is absent/not-live/mismatched | Non-retriable queue drop | No domain event/effect | task type, device_id, claimed gateway_id, HMAC/binding category |
| Inbox registry backend lookup fails | Retryable worker error | No domain event before a successful retry; task is not immediately archived | task type, device_id, claimed gateway_id, opaque lookup category |
| `RevokeGatewayCertificate` without permission | PermissionDenied | "permission denied" | actor, gateway_id |
| `RevokeGatewayCertificate` unknown gateway | NotFound | "gateway not found" | actor, gateway_id |
| Agent: gateway cert revoked before handshake | (agent-side) refuse connection | — | gateway_id and fingerprint only after authenticated certificate parsing |
| Agent: current session peer becomes revoked | Session cancellation before next gateway message | Agent reconnect remains blocked until fresh CRL acceptance | gateway_id and authenticated peer fingerprint |
| Agent: CRL cache stale/unloaded, including during an active session | Refuse connection / cancel live session fail-closed | — | last refresh and staleness category |

## Rollout and migration

- **Existing baseline.** The reviewed source has already removed the static
  `--tls-cert`/`--tls-key` path, self-enrolls every Gateway with
  `PM_GATEWAY_ENROLL_TOKEN`, stamps a per-gateway CN plus agent-facing DNS SAN and
  dual EKUs, uses peer-CN synchronous binding, checks the gateway CRL on new agent
  handshakes, and filters `ListGateways` by heartbeat liveness with a
  certificate-valid fallback. Preserve these as regression gates; do not describe
  or re-implement them as rollout steps.
- **Deploy sequencing:** first land the superseding trust-model ADR; then SDK
  contract corrections → server hostname-authority/renewal/binding/HA work → agent
  live-session revocation → web operator completion. Setup and Compose continue to
  provide the same `PM_GATEWAY_ENROLL_TOKEN` to Control and every Gateway. Control
  derives the sole certificate DNS SAN from `CONTROL_GATEWAY_URL`; each Gateway's
  request hostname must exactly match it. Token rotation updates and restarts both
  consumers. Activation fails if the routing registry is absent.
- **Coordinated gate:** consume spec 37's core harness, exact lane registry, and
  reviewed three-key manifest. Record the exact merge-result `sdk_sha`,
  `server_sha`, and `agent_sha` rather than ambient branch heads, verify downstream
  dependency resolution to `sdk_sha`, and rerun the complete compatible set before
  any repository tag, GitHub Release, or OCI promotion. Web remains outside the
  three Git identities but must build against the tested SDK contract before its
  direct-to-main deployment.
- **Agent compatibility:** the fresh-handshake CRL check already exists. The
  remaining live-session cancellation is a tightening: an older agent keeps its
  current handshake-only behavior and therefore does not terminate an established
  session on later revocation/CRL expiry until upgraded. Call this out in the
  agent release notes.
- **Control HA:** retain accepted ADR 0031, the existing advisory-lock and
  PostgreSQL OIDC-state regression tests, and add the final production-shaped
  multi-replica deployment proof.

## References

- ADR-0005 (gateway↔control device-origin binding), WS12 (CRL fail-closed).
- The `ControlService.Register` enrollment path
  ([registration_handler.go](../../../server/internal/api/registration_handler.go)):
  token/rate-limit/CSR-sign machinery this spec reuses.
- The reused primitives: `ca.IssueCertificateFromCSR`, `mtls.PeerClassURI`,
  `crl.Store`/`crl.Cache`, `store.TryWithAdvisoryLock`.
- spec 29 (task-HMAC, compensating control for a Valkey compromise); spec 32
  (datastore auth hardening, reuses this spec's per-component identities).
- ADR 0031 already records the accepted control-HA/advisory-lock model. On
  approval, write only the superseding gateway-identity ADR required above to
  reconcile shared-token enrollment, ephemeral identity, DNS/CN/SPIFFE authority,
  the shared CA/action-signing-key reality, and handshake/live-session CRL behavior.

## Implementation status (verified 2026-07-17)

The pre-existing enrollment/renewal/CRL/HA baseline this spec builds on is
shipped and regression-covered: `gwenroll` client, `EnrollGateway` (constant-time
token compare + 5/min/IP rate limit), gateway cert issuance (ClientAuth/ServerAuth
+ gateway-class SAN), `RenewGatewayCertificate` (PoP + superseded-fingerprint
revocation), CRL publish/consume, advisory-locked stale-execution expiry,
shared-Postgres OIDC state, and the agent handshake-time CRL gate.

The spec's own hardening deltas are **not yet landed** — it stays `draft`:

1. **Control-authoritative DNS SAN (AC1):** `EnrollGateway` still trusts the
   caller-supplied `hostname`; the canonical host is not derived from
   `CONTROL_GATEWAY_URL` and IP literals are not rejected.
2. **Token-hash-prefix log (AC3):** `EnrollGateway` still logs an 8-char
   token-hash prefix.
3. **Renewal DNS-SAN rejection (AC7):** renewal warns-and-issues with an empty
   hostname instead of forcing re-enroll.
4. **Async inbox retry classification (AC9):** a registry backend lookup failure
   is collapsed into `asynq.SkipRetry` instead of staying retryable.
5. **nil/single-gateway registry bypass (AC9/AC14):** still present in the
   binding resolver and inbox worker.
6. **Agent live-session revocation cancellation (AC11):** only handshake-time
   revocation exists; a live session is not cancelled on CRL refresh.
