# mTLS and signed actions

mTLS terminates at the gateway. Every agent presents a CA-signed client certificate. The gateway verifies it through `tls.RequireAndVerifyClientCert` plus a SPIFFE peer-class SAN check: `agent` for device agents, `gateway` and `control` for the inter-service mTLS.

On top of mTLS, every dispatched action carries an RSA signature over `(actionID, type, paramsJSON)` that the agent verifies before executing. That means:

- A compromised gateway still can't forge a dispatch the agent will run. The agent rejects anything unsigned or tampered with.
- Action-payload integrity is end-to-end (control → agent), not hop-by-hop.
- Instant actions (`REBOOT`, `SYNC`) are signed over `actionID || type || "{}"`, so the same verifier covers parameterless actions.

**TODO: expand with cert lifecycle, rotation semantics, and the trust-bundle reload path.**
