---
title: "Configurable redirect-following for the SDK remote source"
status: draft
created: 2026-06-27
---

# Configurable redirect-following for the SDK remote source

## Overview

The SDK `remote.HTTP` source refuses any redirect that changes scheme or host.
GitHub now serves release-asset downloads as a 302 from `github.com` to
`release-assets.githubusercontent.com` (a different host), so the agent's
self-update binary download — which goes through `remote.HTTP` — is refused.
This spec adds a `Redirect RedirectPolicy` field to `remote.HTTPConfig` with
three ordered levels — `RedirectNone`, `RedirectSameOrigin` (the default and
zero value), and `RedirectCrossOrigin`. On top of that mechanism, the
self-update action gains an operator-settable `allow_redirect` flag (proto,
default false) so an operator explicitly decides whether a self-update download
may follow a cross-origin redirect; package downloads (deb/rpm/appimage) follow
cross-origin redirects only when sha256-pinned. A redirect must never strip TLS,
so an `https → http` downgrade stays refused at every level.

## Motivation

`control`/agent self-update is broken for the standard GitHub-release
distribution path:

```
download binary: GET https://github.com/manchtools/power-manage-agent/releases/download/v2026.07.01-rc2/power-manage-agent-linux-arm64:
  remote: invalid source config: refusing cross-origin redirect https://github.com -> https://release-assets.githubusercontent.com
```

The refusal comes from the strict redirect guard in `defaultHTTPClient`
(`sdk/sys/remote/http.go`). The guard exists for good reasons (anti-substitution
on unpinned fetches, anti-SSRF, anti-TLS-downgrade), but it has no opt-out, and
GitHub-CDN host changes are a legitimate, expected redirect. Two further facts
make this worth fixing cleanly:

- The agent's **checksum** download (`downloadAndExtractChecksum`) uses a
  *different* client (`Executor.httpClient`, Go's default redirect policy), so it
  silently follows the redirect and works — an asymmetry that made the failure
  confusing and that also lets the checksum fetch be downgraded to `http`.
- The binary fetch is always sha256-pinned, so a followed redirect cannot
  substitute bytes undetected; the same-origin guard adds real protection only
  for the unpinned case.

## Acceptance criteria

1. Given the default `RedirectSameOrigin` (the zero value), when a fetch
   encounters a same-scheme, same-host redirect (path/query changes only), then
   it is followed; when it encounters a host or scheme change, then it is refused
   with `ErrInvalidConfig` (unchanged historical behaviour).
2. Given `RedirectNone`, when a fetch encounters any redirect — including a
   same-origin path redirect — then it is refused with `ErrInvalidConfig`.
3. Given `RedirectCrossOrigin`, when a fetch encounters an `https → https`
   cross-host redirect, then it is followed and the fetch succeeds; an
   `http → https` upgrade is likewise followed.
4. Given `RedirectCrossOrigin` and a `ChecksumSHA256` pin, when the redirect
   target serves bytes that do not match the pin, then the fetch fails with
   `ErrIntegrity` (the pin still governs integrity).
5. Given any policy level, when a redirect attempts an `https → http` scheme
   downgrade, then it is refused with `ErrInvalidConfig` (TLS strip is never
   allowed — including at `RedirectCrossOrigin`).
6. Given `RedirectSameOrigin` or `RedirectCrossOrigin`, when a redirect chain
   exceeds 10 hops, then it is refused with `ErrInvalidConfig` (the hop bound is
   preserved).
7. The `Redirect` policy is honoured identically by both `remote.NewHTTP(...).Fetch`
   and `remote.FetchBytes(...)` (both funnel through `newHTTPSource`).
8. Given an `AGENT_UPDATE` action with `allow_redirect = true` whose binary URL
   302-redirects to a different host over https, when the agent downloads and the
   bytes match the resolved checksum, then the update proceeds (the reported bug
   is fixed).
9. Given an `AGENT_UPDATE` action with `allow_redirect = false` (the proto
   default), when the binary or checksum URL redirects to a different host, then
   the download is refused — the operator has not opted in.
10. The agent's checksum download follows the same hardened path
    (`remote.FetchBytes` with the operator-resolved policy), so it too refuses an
    `https → http` downgrade on redirect.
11. Given a package action (deb/rpm/appimage) whose URL redirects cross-origin,
    when a `checksum_sha256` is set, then the redirect is followed (the pin keeps
    the bytes honest); when it is absent, then the redirect is refused.
12. The web self-update form exposes an "allow redirect" toggle, defaulting on
    (its prefilled URLs are GitHub release downloads, which redirect), round-trips
    through `allow_redirect`, and the agent honours the operator's choice.

## Out of scope

- A per-host redirect allow-list. The consumer opts in per fetch with a policy
  level; GitHub renames its CDN hosts over time, so a hostname allow-list would
  be both more config and more brittle.
- Any policy level that permits an `https → http` downgrade. The downgrade
  refusal is retained as a hard invariant across all levels.
- Changing the default redirect behaviour for any existing caller — `Redirect`
  defaults to `RedirectSameOrigin` and the proto `allow_redirect` defaults false.
- A redirect knob on package actions (deb/rpm/appimage). Those stay pin-aware:
  cross-origin only when the operator already pinned a checksum.
- Database or server-logic changes. The server only rebuilds against the
  regenerated SDK; the `allow_redirect` bool needs no new validation.

## Technical design

### Affected packages

- `sdk/sys/remote/http.go` — add `type RedirectPolicy int` with
  `RedirectSameOrigin` (zero value), `RedirectNone`, `RedirectCrossOrigin`; add a
  `Redirect RedirectPolicy` field to `HTTPConfig`; extract the policy into
  `redirectPolicy(p RedirectPolicy)`; `defaultHTTPClient` takes the policy;
  `newHTTPSource` passes `cfg.Redirect`. Fix the stale comment that claims
  redirects are left to Go's default.
- `sdk/proto/pm/v1/actions.proto` — add `bool allow_redirect = 4` to
  `AgentUpdateParams` (mirrors `allow_downgrade`: an explicit, CA-signed operator
  decision, `@gotags validate:"omitempty"`). Regenerate Go + TS.
- `agent/internal/executor/download.go` — `fetchArtifact` gains a
  `redirect remote.RedirectPolicy`; `redirectForArtifact(checksum)` returns
  `RedirectCrossOrigin` only when pinned, else `RedirectSameOrigin`.
- `agent/internal/executor/agent_update.go` — `updateRedirectPolicy(params)`
  resolves the policy from `allow_redirect` (true → cross-origin, default
  same-origin); both the binary download and the checksum download (now via
  `remote.FetchBytes`, replacing the bespoke `Executor.httpClient` loop) use it.
- `agent/internal/executor/action_deb.go`, `action_rpm.go`, `action_appimage.go`
  — pass `redirectForArtifact(params.ChecksumSha256)` (pin-aware).
- `web/.../forms/AgentUpdateParamsForm.svelte`, `forms/types.ts`,
  `ActionParamsDisplay.svelte`, `messages/{en,de}.json` — operator toggle bound
  to `allow_redirect`, defaulting on (prefilled GitHub URLs redirect).

### Redirect policy

Ordered levels, zero value = historical default:

- `RedirectNone` — refuse every redirect.
- `RedirectSameOrigin` (default) — follow only same-scheme, same-host redirects
  (path/query changes); refuse host or scheme changes.
- `RedirectCrossOrigin` — additionally follow host changes and `http → https`
  upgrades (CDNs like GitHub releases).

At **every** level: an `https → http` downgrade is refused (a redirect must never
strip TLS), and the chain is bounded to 10 hops.

### New dependencies

None.

## Security considerations

- **Integrity:** the agent binary fetch is always sha256-pinned
  (`expected_sha256` or the hash resolved from `checksum_url`), so a followed
  redirect cannot substitute bytes — a mismatch is `ErrIntegrity`. The `Redirect`
  policy does not relax any pin, size cap, scheme-https gate (enforced upstream by
  `sdk.ValidateHTTPSURL`), or atomic-write guarantee.
- **TLS:** `https → http` downgrade on redirect is refused at every policy level
  (including `RedirectCrossOrigin`), so a redirect can never strip transport
  integrity.
- **SSRF:** the source URL rides inside a signed `AGENT_UPDATE` action and is
  operator-configured; redirect targets are reached only for an
  operator-specified, signed origin. The downgrade refusal and hop bound remain.
- **Operator control / fail-closed:** `allow_redirect` defaults false, so an
  action that does not set it keeps the strict same-origin guard — following a
  cross-origin redirect on a self-update is an explicit, CA-signed operator
  decision (the same posture as `allow_downgrade`). The web form prefills it on
  only because its default URLs are GitHub releases.
- **Trust boundary:** the new `allow_redirect` proto field carries
  `@gotags validate:"omitempty"`; it is a proto3 scalar bool (no presence), so
  the type-aware protovalidate gate exempts it, like `allow_downgrade`.

## Test requirements

### SDK unit tests (`sdk/sys/remote/http_test.go`)

- `redirectPolicy(RedirectNone)`: same-origin path redirect refused; any redirect
  refused.
- `redirectPolicy(RedirectSameOrigin)`: same-origin path redirect allowed;
  cross-host refused; scheme change refused; >10 hops refused.
- `redirectPolicy(RedirectCrossOrigin)`: cross-host `https → https` allowed;
  `http → https` upgrade allowed; `https → http` downgrade refused; >10 hops
  refused.

### SDK integration tests (httptest)

- Two `httptest` servers (cross-port = cross-origin): server A 302 → server B.
  `RedirectCrossOrigin` + correct pin → `Fetch`/`FetchBytes` succeed and bytes
  match. Default `RedirectSameOrigin` → `ErrInvalidConfig`. `RedirectCrossOrigin`
  + wrong pin → `ErrIntegrity`.

### Agent regression test (`agent/internal/executor`)

- `fetchArtifact` against a redirecting plain-HTTP httptest pair (cross-port =
  cross-origin) with `remoteHTTPClient` forced nil so the policy is live:
  `RedirectSameOrigin` is refused; `RedirectCrossOrigin` follows and the pin
  verifies the bytes.
- `updateRedirectPolicy`: `allow_redirect=true → RedirectCrossOrigin`; default →
  `RedirectSameOrigin`. `redirectForArtifact`: pinned → cross-origin, unpinned →
  same-origin.

## Rejection paths

| Scenario | Error | Client-visible message | Logged context |
|----------|-------|------------------------|----------------|
| Any redirect at `RedirectNone` | `ErrInvalidConfig` | "refusing redirect (policy: none)" | from/to scheme+host |
| Cross-host redirect at `RedirectSameOrigin` | `ErrInvalidConfig` | "refusing cross-origin redirect A -> B" | from/to scheme+host |
| `https→http` downgrade at any level | `ErrInvalidConfig` | "refusing scheme downgrade https -> http" | from/to scheme+host |
| >10 hops | `ErrInvalidConfig` | "stopped after 10 redirects" | hop count |
| Redirect target bytes ≠ pin | `ErrIntegrity` | "binary does not match the expected_sha256 pin" | expected vs actual digest |

## Rollout and migration

Backward-compatible: `AllowRedirect` defaults to `false`, so existing callers are
unchanged. Ships as: SDK PR → SDK tag (`v0.5.x`) → agent `go.mod` bump → new
agent RC. No DB migration, no feature flag.

## References

- WS7 agent self-update authenticity — [[project_ws7_agent_update_authenticity]]
- `sdk/sys/remote/http.go` `defaultHTTPClient` redirect guard
- GitHub release-asset host change: `github.com` → `release-assets.githubusercontent.com`
