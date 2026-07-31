---
title: "Gateway removal: control terminates agent mTLS directly"
status: draft
created: 2026-07-30
---

# Gateway removal: control terminates agent mTLS directly

## Overview

The gateway tier is deleted. Agents connect to **control** directly over mTLS, and control
hosts `AgentService` itself. Traefik provides SNI passthrough on the agent route so control
sees the agent's certificate (already ruled: PROXY protocol v2 for client-address
attribution).

This is a **deletion**, not a rewrite. `AgentHandler.Stream()` already lives in
`server/internal/handler/agent.go:302`, outside the gateway package — control mounts a handler
that exists today. Measured surface removed from the server:

| Package | prod LOC | test LOC |
|---|---:|---:|
| `server/cmd/gateway` | 1,068 | 235 |
| `server/internal/gateway` | 1,300 | 1,218 |
| `server/internal/gwenroll` | 187 | 155 |
| | **2,555** | **1,608** |

Plus the machinery that exists *only because* a relay sits between agent and control, listed
under Scope.

## Motivation

The gateway is an untrusted relay. Nearly every awkward mechanism in the transport path exists
to work around that untrust:

- **LPS/LUKS transport sealing.** `sdk/crypto/lps.go:15` states the purpose outright: the agent
  seals rotated passwords to control's X25519 public key *"so the relaying gateway (the
  least-trusted server-side actor) can never read it"*. `luks.go:20` says the same for
  disk-encryption secrets. With no relay, the agent's mTLS terminates at control — the only
  party that could open the blob anyway.
- **The CRL distribution RPC.** `GetCertificateRevocationList` exists so an agent can check its
  *gateway's* certificate before trusting it. With control as the peer, the list would have to
  be fetched from the host it judges, which is circular and fails closed before first load.
- **`InternalService/Proxy*`** — eight RPCs so the gateway can reach credential-bearing
  operations without holding a datastore.
- **Per-device task queues** routing Control→Gateway, which is a principal reason Valkey is a
  hard dependency.
- **Gateway enrollment, gateway certificates, and the device→gateway binding registry.**

Removing the tier removes all of it. This spec is a prerequisite for the queue/Valkey removal,
which cannot proceed while per-device queues exist to feed gateways.

## Scope

### Deleted

1. `server/cmd/gateway`, `server/internal/gateway`, `server/internal/gwenroll`.
2. `GatewayAuthService.EnrollGateway`; `GatewayService.ListGatewayTerminalSessions` and
   `.TerminateGatewayTerminalSession`.
3. `ControlService.ListGateways`, `.RevokeGatewayCertificate`,
   `.GetCertificateRevocationList`.
4. All eight `InternalService` RPCs — the six `Proxy*` relays plus `VerifyDevice` and
   `RenewGatewayCertificate` — and `server/internal/handler/control_proxy.go`.
5. The device→gateway binding registry and `server/internal/api/gateway_binding.go`.
6. **LPS/LUKS transport sealing:** `sdk/crypto/lps.go`, `sdk/crypto/luks.go`, the transport use
   of `sdk/crypto/seal.go`, control's sealing keypair, the signed `lps_public_key`
   distribution, and the agent's `ApplyLpsPublicKey` / `lpsPublicKey` storage.
7. The agent's CRL cache (`agent/internal/crl`).

### Explicitly NOT deleted — the failure mode this spec must avoid

8. **Agent-certificate revocation.** A stolen device certificate must stop working. This is
   *not* the gateway CRL; it is control checking its own table during the mTLS handshake. No
   published list, no distribution, no agent-side cache.
9. **The context AAD binding — LUKS fully, LPS partially.** `luksSealAAD(device, action)` is
   byte-identical to the at-rest `SecretAAD(device, action, "luks")`, so LUKS relocation
   protection carries over untouched. `lpsSealAAD(device, action, username)` does **not**: at-rest
   is `SecretAAD(device, action, "lps")` and ADR 0009 omits the username on purpose. Cross-device
   and cross-action relocation stay closed for both; the within-action username binding ends with
   the seal. See criterion 8a — this is a stated consequence, not an oversight.
10. **LPS/LUKS domain separation** (distinct HKDF info strings, `TestLuksLpsDomainSeparation`)
    carries over to the at-rest domain tags.
11. `sdk/crypto/aead.go` (AES-256-GCM) — the at-rest primitive, untouched, and a *different*
    primitive from `seal`.
12. Terminal sessions including ordered chunk capture with its `last_sequence` guard and 8 MiB
    cap, and everything `AgentHandler.Stream()` does today.

## Acceptance criteria

Numbered, testable. Each has a rejection path.

### Transport

1. Given a running control and no gateway process, when an enrolled agent connects, then it
   establishes the `AgentService` bidi stream against control and completes the handshake,
   dispatch, result-submission and heartbeat paths unchanged.
2. Given Traefik configured for SNI passthrough on the agent route, when an agent connects,
   then control observes the agent's client certificate directly and resolves the real client
   address from the PROXY v2 header.
3. Given an agent presenting a certificate whose peer class is not `agent`, when it calls
   `AgentService`, then it is rejected. The existing peer-class gate is preserved on the
   control-hosted listener.

### Revocation (replaces the CRL, criterion 8)

4. Given an agent certificate recorded as revoked, when that agent attempts an mTLS handshake
   against control, then the connection is refused by a lookup in control's own store — with no
   list fetch, no cache, and no dependency on Valkey.
5. Given a revocation is recorded while an agent's stream is live, when the revocation commits,
   then the live stream is terminated rather than surviving until natural disconnect.
6. Given certificate renewal or device deletion, when either commits, then the revocation row is
   written **in the same transaction**. *Rejection:* the current best-effort ordering
   (`api/certificate_handler.go:189-219`, `api/device_handler.go:294-329`) leaves a window in
   which a superseded certificate is still accepted; reproducing it fails this criterion.

### Secrets (criteria 6, 9, 10)

7. Given an agent reports a rotated LPS password or a LUKS passphrase, when it submits over the
   direct mTLS stream, then the value is transmitted without X25519 sealing and stored encrypted
   at rest with `aead`.
8. **LUKS only** — given a stored LUKS secret, when its at-rest AAD is constructed, then it binds
   `(device, action)` under the LUKS domain **exactly as the transport AAD did**; verified:
   `SecretAAD(device, action, "luks")` is byte-identical to the transport `luksSealAAD`.
   *Rejection:* a blob valid for `(device A, action X)` accepted for `(device B, action X)` fails.

8a. **LPS — the username component is NOT preserved, and an earlier draft of this criterion
   wrongly claimed it was.** Verified: the at-rest AAD is `SecretAAD(device, action, "lps")` with
   no username, and ADR 0009 omits it deliberately — *"a within-action username swap is a minor
   residual inside a single trusted rotation batch."* The transport AAD bound the username; at-rest
   never has. So this criterion does **not** require preserving it.

   What ends is an end-to-end correctness check, not a confidentiality boundary: a caller
   authorised for `GetDeviceLpsPasswords` on a device already receives every username's password,
   so nothing is newly disclosed. Adding username to the LPS at-rest AAD would close ADR 0009's
   accepted residual and restore the check — **ruled separately, not required by this spec**,
   because the residual predates this change and is unaffected by it.
9. Given a LUKS secret, when opened under the LPS domain tag, then it fails. *Rejection:* domain
   separation must hold at rest, as `TestLuksLpsDomainSeparation` asserts for transport today.

### Surface

10. Given the full service descriptor set after the change (the removals span ControlService,
    GatewayService, GatewayAuthService and InternalService), then exactly the 14 RPCs listed
    under Scope items 2–4 are absent and **no others**. The comparison is against a checked-in
    golden list derived from the predecessor descriptor, not regenerated from the new one.
    *Rejection:* deriving both sides from the post-change descriptor lets an accidentally
    dropped RPC vanish from both and pass.
11. Given the built control binary and the module graph, then no package under
    `internal/gateway`, `internal/gwenroll` or `cmd/gateway` is reachable, with a matches-zero
    assertion on the scan.
12. Given `auth.AllPermissions` after the change, then permissions orphaned by the deleted RPCs
    are removed and every remaining permission is still reachable from some procedure.

### Deployment

13. Given the compose stack, then it starts with no gateway service, and the deployment E2E
    suite drives every externally reachable RPC through generated clients as an exact set from
    the descriptors, failing on TLS-handshake or bad-certificate log evidence.
14. Given an agent built before this change, when it connects to the new control, then it fails
    cleanly with a clear error rather than hanging. *(Pre-alpha: agents are reinstalled, not
    migrated. This criterion is about a legible failure, not compatibility.)*

## Rejection paths

| # | Condition | Expected |
|---|---|---|
| R1 | Non-agent peer class on `AgentService` | Rejected, connection closed |
| R2 | Revoked agent certificate at handshake | Refused by store lookup |
| R3 | Revocation committed during a live stream | Stream terminated |
| R4 | Renewal commits, revocation write fails | Whole transaction rolls back |
| R5 | LPS blob replayed against another device | AAD mismatch, rejected |
| R6 | LUKS blob opened under LPS domain | Domain mismatch, rejected |
| R7 | RPC absent from implementation and golden list | Gate fails on review, not silently |
| R8 | Any `internal/gateway` symbol reachable from the control binary | Guard fails |

## Effect on the existing spec corpus

Swept by glob over `docs/content/06-specs/*.md`; 19 specs reference the gateway, sealed transport
or the CRL. Only the three below are **superseded**, and each is marked at its own Overview rather
than by a note here — a reader landing mid-file must see it.

| Spec | Was | Why superseded |
|---|---|---|
| 18 LPS sealed transport | implemented | Exists to make the gateway "a pure opaque relay". No relay, no purpose. |
| 25 LUKS sealed transport | implemented | Its own premise is "the identical gateway-cleartext exposure spec 18 closed". |
| 31 Gateway enrollment + control HA | draft | Nothing to enroll; HA separately retired by single-instance. |

**Affected but standing — these need review during implementation and are NOT certified here,
because I have read only their overviews:** 10 (server spec), 12 (agent spec), 32 (datastore auth
hardening — the Valkey half moves when the queues go, the Postgres half stands), 34 (signed sync
manifest — the relay threat weakens but agent↔control signing stands), 37 (deployment E2E — must
drop gateway services; this spec's criterion 13 depends on it), 38 (agent offline reenrollment —
endpoints change, feature stands), 40 (registration authority). Reviewing each is part of the
implementation, not a precondition of this spec.

## Out of scope

Queue and Valkey removal (unblocked by this spec, specified separately). The projector collapse.
The datastore question. Any change to the web repository.
