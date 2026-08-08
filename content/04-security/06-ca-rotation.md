---
title: CA rotation
---
# CA rotation

Setup creates `certs/ca-trust-bundle.crt` containing the active CA and configures
control with `POWER_MANAGE_CA_TRUST_BUNDLE_FILE`. The bundle is read only at
startup; changing it has no effect until control is restarted.

<!-- docref: begin src=server:cmd/control/main.go#run,server:internal/ca/ca.go#CA.SetTrustBundle -->
The active certificate and key still come from `POWER_MANAGE_CA_CERT_FILE` and
`POWER_MANAGE_CA_KEY_FILE`. They issue new leaves. The trust bundle is separate:
it controls which old and new agent leaves the mTLS listener accepts during the
overlap. Startup rejects malformed bundles and bundles that omit the active CA.
<!-- docref: end -->

## Rotation procedure

The successor CA must be cross-signed by the current CA. Do not substitute an
unrelated self-signed root: agents deliberately reject that as a silent trust-
anchor swap.

1. Back up `certs/` and generate a new Ed25519 CA key and CSR.
2. Sign the successor CA certificate with the current CA, with critical
   `CA:TRUE` basic constraints and `keyCertSign,cRLSign` key usage.
3. Concatenate the current CA certificate followed by the cross-signed successor
   into `certs/ca-trust-bundle.crt`.
4. Replace `certs/ca.crt` and `certs/ca.key` with the successor certificate and
   key. Keep the current `control.crt` during the overlap; the proxy trusts both
   issuers through the same bundle.
5. Restart the control and reverse-proxy containers so both reload the bundle.

<!-- docref: begin src=server:internal/enrollment/handlers.go#Handlers.RenewCertificate,sdk:crypto/cert.go#VerifyCAContinuity,agent:cmd/power-manage-agent/cert_rotation.go#applyRenewal -->
Existing agents continue connecting with predecessor-issued leaves. At their
normal certificate-renewal point, control signs a new leaf with the active
successor and returns the successor CA certificate. Before saving either value,
the agent verifies that the returned CA is identical to or signed by its enrolled
CA. A failed continuity check leaves its existing certificate and CA untouched.
<!-- docref: end -->

After every enrolled agent has renewed and reconnected under the successor:

1. Reissue `control.crt` under the successor if it is still predecessor-issued.
2. Remove the predecessor from `ca-trust-bundle.crt`, leaving the successor.
3. Restart control and the reverse proxy again.
4. Revoke the predecessor-issued device leaves that are no longer needed.

There is no live trust-bundle reload, CRL distribution RPC, or Gateway cache. If
cross-signing continuity cannot be established, reinstall and cleanly re-enrol
the pre-alpha agent.
