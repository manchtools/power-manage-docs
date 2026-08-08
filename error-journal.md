# Error journal

## 2026-08-08 Shallow analysis: authorized the proxy hop instead of the client hop

**What happened**: I gated the development session endpoint on the loopback
proxy connection and a proxy-held token, which still allowed an externally
reachable token-injecting proxy to mint an administrator session for a remote
client.

**What the user said**: Not user-initiated; hosted Greptile review reproduced
the bypass before merge.

**Root cause**: The workspace rules required trust-boundary tests but did not
state that a reverse proxy terminates the original transport, so backend peer
address checks authenticate the proxy rather than the originating client.

**Harness fix**: `CLAUDE.md` now requires development bypasses to authorize the
original client at proxy ingress and backend, bind credential-injecting proxies
to loopback, and validate forwarded client-address evidence.

**Prevention**: Future proxy-backed authentication changes must trace both
network hops and test a remote client through a loopback backend connection.
