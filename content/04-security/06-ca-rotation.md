---
title: CA rotation
---
# CA rotation

Setup may create a control CA or accept an operator-managed CA. Ordinary
startup never invents a replacement CA.

## Rotation requirements

1. Install the new CA material with restrictive ownership and permissions.
2. Publish the new trust anchor to enrolled agents over their authenticated
   direct connection.
3. Issue replacement device certificates from fresh CSRs.
4. Confirm agents reconnect under the new chain.
5. Revoke the old leaves in the control database and remove the old CA only
   after the fleet is accounted for.

Revocation is checked during the control-side TLS handshake; no distributed
CRL or Gateway cache participates.

If trust continuity cannot be established, reinstall and cleanly re-enrol the
pre-alpha agent rather than adding a compatibility bypass.
