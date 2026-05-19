# mTLS and signed actions

mTLS terminates at the gateway. Every agent presents a CA-signed client certificate. The gateway verifies it through `tls.RequireAndVerifyClientCert` plus a SPIFFE URI SAN check that pins the peer's class: `agent` for device agents, `gateway` and `control` for the inter-service mTLS the `InternalService` proxy uses.

```mermaid
flowchart LR
    Enrol[Enrolment<br/>local socket] -->|CSR + token| Control[Control CA]
    Control -->|signed cert<br/>1 yr| Agent
    Agent -.->|present cert| Gateway
    Gateway -->|verify chain<br/>+ SPIFFE SAN| Agent
    Agent -.->|RenewCertificate<br/>at 80% lifetime| Control
```

## Certificate lifecycle

| Stage | What happens |
|---|---|
| Enrolment | The agent generates a key, sends a CSR through the local `enroll.sock` Unix socket gated by a single-use registration token. The control server signs a cert valid for **1 year**. |
| Steady state | The agent presents the cert on every gateway connection. The gateway verifies the chain and the SPIFFE SAN. |
| Renewal | At **80% of cert lifetime** (~292 days in), the agent calls `RenewCertificate` over its existing mTLS connection. The control server validates the fingerprint, issues a new cert, returns it. |
| Revocation | An admin can revoke a cert from the web UI. The fingerprint goes onto a deny-list the gateway checks on every handshake. |

The CA roots used to sign agent certs are separate from the gateway's server cert and from the control server's HTTPS cert. The 2026.06 milestone is finishing **CA role separation** so the agent CA, the inter-service CA, and the HTTPS CA are independently rotatable.

## Signed actions

On top of mTLS, every dispatched action carries an RSA signature over `(actionID, type, paramsJSON)`. The agent verifies it before executing. That means:

- A compromised gateway can't forge a dispatch the agent will run. The agent rejects anything unsigned or tampered with.
- Action-payload integrity is end-to-end (control → agent), not hop-by-hop.
- Instant actions (`REBOOT`, `SYNC`) are signed over `actionID || type || "{}"`. The same verifier covers parameterless actions.

If the signature doesn't verify, the agent records an `ExecutionFailed` event with the verification error and drops the dispatch. The event ends up in the audit log, so a forgery attempt leaves a trace.

## What the agent verifies, in order

For every dispatch arriving over the bidirectional stream:

1. **TLS handshake** — gateway cert chain + hostname.
2. **Stream identity** — the agent confirms the gateway is presenting a cert with the `gateway` SPIFFE class.
3. **Envelope HMAC** — the Asynq task signing key check (see [Asynq task signing](/security/task-signing)) catches Valkey tampering before the gateway can even forward.
4. **Action signature** — the per-action RSA signature.
5. **Action-type sanity** — the payload deserialises into the expected proto schema and passes inline validation.

A failure at any layer ends the dispatch and emits an event. No silent drops.

## Trust bundle reloads

The control CA's certs are loaded from disk on boot. Rotating the CA without a restart is supported through the `ReloadTrustBundle` RPC on `InternalService`: the gateway picks up the new bundle, drops connections that no longer verify, and accepts re-connects under the new chain. Agents already authenticated with the old CA keep their stream alive until their next renewal, which triggers a fresh cert against the new chain.

In practice, you rotate by:

1. Add the new CA cert alongside the old one in the bundle (both trusted).
2. Wait for agents to renew (or force renewal via `ForceRenewCertificate`). Renewed certs are signed by the new CA.
3. Remove the old CA cert from the bundle.

This is documented in the upcoming `SECURITY.md` ADR landing in 2026.06.
