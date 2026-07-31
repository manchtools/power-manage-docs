---
title: Terminal access
---
# Terminal access

Remote terminal traffic is multiplexed over the agent's existing outbound mTLS
stream. There is no inbound connection to the device and no Gateway relay.

## Authorization

Starting, attaching to, and terminating a session are explicit authorized
operations. Device and role scope are checked at the handler. Session
lifecycle changes and rejected attempts are audited.

## Confidentiality

The terminal byte stream is protected by direct mTLS. Secret-bearing control
messages use recipient-bound field sealing. Terminal content is never copied
into audit rows, ordinary logs, traces, or support bundles.

## Lifecycle

The web UI keeps a terminal surface alive for the lifetime of the session, so
ordinary navigation does not reconnect it. Device disconnect, certificate
revocation, operator termination, or session expiry closes the session and
releases its bounded buffers.
