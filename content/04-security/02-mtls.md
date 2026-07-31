---
title: mTLS and device identity
---
# mTLS and device identity

Agents connect directly to control through a dedicated mTLS listener. Traefik
uses SNI TCP passthrough, so control terminates the device TLS session and
derives device identity from the client certificate.

## Device keys

The device generates its own Ed25519 identity key and CSR. The private key
never leaves the endpoint. Control issues and renews the leaf certificate from
the configured CA.

Application frames are not separately signed. Direct mTLS already provides
peer authentication, confidentiality, integrity, ordering, and replay
protection for the stream.

## Revocation

Control checks certificate revocation against an indexed database row during
the TLS handshake. Revoking a connected device also closes its active stream.
Renewal and deletion commit revocation and audit state in the same transaction.

There is no Gateway CRL, CRL-distribution RPC, or agent-side CRL cache.

## Client addresses

Where the real client address is required, Traefik sends PROXY protocol v2 on
the dedicated passthrough listener. Control accepts it only from an allowlisted
isolated Traefik network; that listener must not be reachable by arbitrary
containers or hosts.

## Secret fields

mTLS does not stop endpoint debug formatting from exposing plaintext after
decryption. Classified protobuf fields are therefore X25519-sealed to their
recipient with direction, message, field, device, and operation context in the
AAD. Generic transport logging remains metadata-only.
