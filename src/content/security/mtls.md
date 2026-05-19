# mTLS + signed actions

The mTLS layer terminates at the gateway. Every agent presents a CA-signed client certificate, and the gateway verifies via `tls.RequireAndVerifyClientCert` plus a SPIFFE peer-class SAN check (`agent` for device agents; `gateway` and `control` for inter-service mTLS).

On top of mTLS, every dispatched action carries an RSA signature over `(actionID, type, paramsJSON)` that the agent verifies before executing. This means:

- A compromised gateway still can't forge a dispatch the agent will execute — the agent rejects unsigned or tampered payloads.
- Action-payload integrity is end-to-end (control → agent), not hop-by-hop.
- Instant actions (`REBOOT`, `SYNC`) are signed over `actionID || type || "{}"` so the same verifier covers parameterless actions.

**TODO: expand with cert lifecycle, rotation semantics, and the trust-bundle reload path.**
