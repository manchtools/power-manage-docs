---
title: "Operator CLI and native OIDC login"
status: draft
created: 2026-08-08
---

# Operator CLI and native OIDC login

## Overview

Power Manage ships an MIT-licensed `powermanage` command in the SDK repository.
It lets an operator bootstrap the first OIDC provider, sign in interactively
through a browser without the hosted web client, obtain a short-lived access
token for local Terraform, and call the existing action, assignment, and device
enrollment-token RPCs. Structured requests and responses use canonical
ProtoJSON. The CLI owns the loopback callback, OAuth state comparison, PKCE
verifier, authorization-code exchange, and IdP tokens; control receives only a
one-time login state and the OIDC ID-token assertion it must verify before
issuing an ordinary Power Manage session.

## Motivation

The open self-hosted product currently has no operator client. The separately
hosted proprietary web application can consume the public API, but it is not a
deployment or release component. An operator who wants to bootstrap OIDC,
drive the API directly, or run Terraform should not need that application.

The existing contract already supplies bootstrap authentication, session
refresh/logout, action authoring, assignments, and enrollment tokens. The
missing pieces are a native/public OIDC exchange that keeps native-client
credentials local and a small command-line client over the generated Connect
transport.

## Acceptance criteria

### Provider configuration and bootstrap

1. Given a fresh deployment and a valid single-use bootstrap token, when
   `powermanage bootstrap oidc --file provider.json --token-stdin` receives a
   canonical ProtoJSON `CreateIdentityProviderRequest` containing a CLI client
   ID, issuer, JIT policy, and the Admin default-role ID, then it performs
   exactly one `CreateIdentityProvider` call with the
   `PowerManage-Bootstrap` scheme, persists neither the bootstrap token nor the
   request's provider secret, and prints the canonical ProtoJSON response.
2. Given `control bootstrap-admin --output token`, when issuance succeeds,
   then stdout contains only the raw single-use token plus its terminating
   newline; the existing human setup-URL output remains the default when the
   flag is absent, and neither mode logs the token.
3. Given provider creation or update, when at least one of browser `client_id`
   or public `cli_client_id` is present, then the provider is accepted. When
   both are absent, or a browser client secret is supplied without a browser
   client ID, the request is rejected as `InvalidArgument` before any write.
4. Given a CLI-only provider, when it is created with `cli_client_id` and no
   browser client ID or secret, then it can perform native CLI login and cannot
   start the existing browser/server code-exchange flow. Given a browser-only
   provider, the inverse holds. The two client IDs may be equal when one public
   IdP registration supports both redirect classes.
5. Given `ListAuthMethods`, when an enabled provider is returned, then its
   public metadata reports browser-login and CLI-login availability without
   exposing either client ID, any client secret, issuer details, or account
   existence.

### Native OIDC login

6. Given `powermanage login --provider <slug>`, when login starts, then the CLI
   binds an HTTP listener to `127.0.0.1` before requesting an authorization URL,
   generates a cryptographically random PKCE verifier locally, derives its S256
   challenge, and sends only the challenge and actual loopback redirect URI to
   `BeginCLILogin`.
7. Given an enabled provider with a CLI client ID, a strict loopback redirect,
   and a valid S256 challenge, when `BeginCLILogin` succeeds, then control
   generates cryptographically random state and nonce, stores a ten-minute
   one-use CLI login state, and returns a login URL containing the provider's
   CLI client ID, state, nonce, redirect URI, scopes, challenge, and
   `code_challenge_method=S256`, plus the public token endpoint required for
   local exchange.
8. Given the browser callback, when its state differs from the state returned
   by `BeginCLILogin`, or it contains an OAuth error or no authorization code,
   then the CLI refuses it before contacting the token endpoint or control.
9. Given a valid callback, when the CLI exchanges the authorization code, then
   it posts the code, redirect URI, CLI client ID, and local PKCE verifier
   directly to the IdP token endpoint over HTTPS. It sends no client secret,
   bounds the response size and duration, retains only the returned ID token,
   and never sends the authorization code, verifier, IdP access token, or IdP
   refresh token to control.
10. Given a signed ID token whose issuer, CLI-client audience, expiry, nonce,
    and provider match the unspent CLI login state, when
    `ExchangeCLISession` receives it, then control atomically consumes that
    state, applies the existing link/JIT/group and disabled-subject rules,
    audits the login, and returns an ordinary Power Manage access/refresh token
    pair and user.
11. Given a replayed/expired state, browser state presented to the CLI exchange,
    wrong provider, signature, issuer, audience, nonce, disabled provider, or
    ineligible subject, when `ExchangeCLISession` is called, then it returns an
    opaque `Unauthenticated` or provider-hiding `NotFound` result as specified
    in the rejection table, issues no session, and records the required
    rejected-authentication audit operation without secret material.
12. Given the existing browser SSO flow, when it starts and completes, then its
    server-held PKCE exchange remains behaviorally unchanged and it cannot
    consume a CLI login state; likewise the CLI exchange cannot consume a
    browser state.

### Local session and Terraform handoff

13. Given successful login, when credentials are persisted, then the CLI writes
    its configuration directory with mode `0700` and its session file with mode
    `0600` using an atomic same-directory replacement, refuses symlinked or
    group/world-accessible credential files, and never logs or includes the
    refresh token in ordinary command output.
14. Given a still-valid cached access token, when a command runs, then it uses
    that token without refreshing. Given a token inside the refresh skew or an
    explicit server `token_expired` response, then one file-locked refresh
    rotates and atomically persists the new token pair before the command is
    sent or retried; concurrent CLI processes cannot both spend one refresh
    token.
15. Given `powermanage auth token`, when a valid session exists, then it prints
    JSON containing only the server URL, short-lived Power Manage access token,
    and expiry. It never prints or stores an IdP token or exposes the Power
    Manage refresh token, so a local Terraform provider can use it as an exec
    credential without putting a refresh token in Terraform state.
16. Given `powermanage whoami`, when authenticated, then it prints the canonical
    ProtoJSON `GetCurrentUserResponse`. Given `powermanage logout`, when control
    acknowledges refresh-token revocation, then the local session file is
    removed; a network failure leaves it in place and returns a retryable error.

### ProtoJSON resource commands

17. Given any resource command with `--file <path>` or `--file -`, when the
    input is valid canonical ProtoJSON for that command's generated request
    message, then the CLI decodes it directly with `protojson.Unmarshal`, sends
    that exact generated request through `ControlServiceClient`, and prints the
    response with `protojson.Marshal`. No YAML or generic map translation is
    involved.
18. Given malformed JSON, an unknown field, a wrong protobuf type/enum, a
    missing required CLI file, or input larger than the public control request
    limit, when a resource command is invoked, then it fails locally before
    making a network request. Proto validation and authorization are still
    enforced independently by control.
19. Given a logged-in user with `CreateAction`, when
    `powermanage action create --file request.json` receives a valid
    `CreateActionRequest`, then it returns the created action as ProtoJSON.
    `action get <id>`, `action list`, and `action delete <id>` call their
    corresponding existing RPCs without changing action semantics.
20. Given a created action/action set/definition and a target, when
    `powermanage assignment create --file request.json` receives a valid
    `CreateAssignmentRequest`, then the assignment is created and returned as
    ProtoJSON. `assignment list` and `assignment delete <id>` call their
    corresponding existing RPCs.
21. Given a user with `CreateToken`, when
    `powermanage enrollment-token create --file request.json` receives a valid
    `CreateTokenRequest`, then the response prints the bearer value and CA pin
    exactly once as the existing RPC returned them. `get`, `list`, `enable`,
    `disable`, and `delete` never claim that the bearer value can be recovered.
22. Given any resource command, when the server returns `PermissionDenied`,
    `NotFound`, `InvalidArgument`, or another Connect status, then the CLI exits
    non-zero with the status and safe server message on stderr, emits no partial
    success JSON, and never widens or substitutes the caller's authorization.

### Packaging and operability

23. Given the SDK module, when it builds and tests, then `cmd/powermanage`
    produces the operator binary and uses the generated protobuf/Connect client
    directly. Cobra supplies the explicit command tree; no RPC-to-command code
    generator, reflection-based generic RPC command, YAML dependency, service
    account, or hosted-web dependency is introduced.
24. Given `powermanage config set-server <url>`, when the URL is HTTPS, or HTTP
    with a literal loopback host for local development, then it is stored as the
    current server. URLs containing userinfo, query, fragment, a non-HTTP(S)
    scheme, or non-loopback cleartext HTTP are rejected locally.
25. Given the final contract descriptor, then the only new RPCs are
    `BeginCLILogin` and `ExchangeCLISession`; all existing action, assignment,
    enrollment-token, browser SSO, bootstrap, refresh, and logout RPCs remain.

## Out of scope

- Unattended service accounts, client credentials, workload identity, or CI
  login. Every CLI session begins with an interactive human OIDC login.
- A Terraform provider. This spec provides its local exec-credential input.
- A server-hosted login callback, device-code broker, hosted-web dependency, or
  web repository change.
- Generating Cobra commands from protobuf descriptors or exposing a generic raw
  RPC command.
- YAML input, YAML output, or a YAML-to-JSON adapter.
- Full CLI coverage of every Control RPC. The first slice is authentication,
  bootstrap, actions, assignments, and enrollment tokens.
- Named multi-server contexts, Windows support, OS keychain integration, shell
  completion, and an installer/package manager for the CLI.
- Backward-compatible schema or wire migration. The project is pre-alpha and
  takes a clean contract/schema cut.

## Technical design

### Affected packages

- `sdk/proto/powermanage/v1/control.proto` — provider capability fields and the
  two explicit native-login RPCs.
- `sdk/gen/{go,ts}` — regenerated clients only; never hand-edited.
- `sdk/cmd/powermanage` — Cobra command tree, loopback login, strict local
  config/session store, ProtoJSON request/response plumbing, and generated
  Control client calls.
- `server/internal/identity` and `server/internal/idp` — CLI authorization URL,
  ID-token verification, shared linking/session completion, and provider-mode
  validation.
- `server/internal/auth` and `server/internal/controlruntime` — exact public
  procedure classification and local rate limits for the two new endpoints.
- `server/internal/store/{sqliteschema,queries}` — CLI client ID and login-flow
  kind in the clean SQLite baseline.
- `server/cmd/control` — machine-readable bootstrap token output.
- `docs/content` — installation, SSO, and CLI operator documentation after the
  implementation is green.

### Proto changes

`IdentityProvider`, `CreateIdentityProviderRequest`, and
`UpdateIdentityProviderRequest` gain an optional `cli_client_id`. Browser
`client_id` and `client_secret` become optional; handler validation requires at
least one client ID and requires a browser ID whenever a browser secret is
present. `AuthMethodProvider` gains `browser_login` and `cli_login` booleans.

New messages and RPCs:

```proto
message BeginCLILoginRequest {
  string slug = 1;           // required, 1..64
  string redirect_url = 2;   // required URL; handler requires http loopback
  string code_challenge = 3; // required 43-char raw base64url S256 challenge
}

message BeginCLILoginResponse {
  string login_url = 1;
  string state = 2;
  string token_url = 3;
  string client_id = 4;
  google.protobuf.Timestamp expires_at = 5;
}

message ExchangeCLISessionRequest {
  string slug = 1;     // required, 1..64
  string state = 2;    // required, bounded
  string id_token = 3; // required, bounded
}

message ExchangeCLISessionResponse {
  string access_token = 1;
  string refresh_token = 2;
  google.protobuf.Timestamp expires_at = 3;
  User user = 4;
}

rpc BeginCLILogin(BeginCLILoginRequest) returns (BeginCLILoginResponse);
rpc ExchangeCLISession(ExchangeCLISessionRequest)
    returns (ExchangeCLISessionResponse);
```

Every field receives the concrete generated validation tag required by its
acceptance and rejection paths. The handler repeats security-specific shape
checks that cannot be expressed by tags, especially literal loopback,
userinfo/query/fragment exclusion, and raw-base64url S256 form.

### OIDC flow

`BeginCLILogin` constructs a public-client authorization URL from the stored
provider metadata but never opens the browser. The CLI binds first, generates
the verifier, calls the RPC, remembers the returned state, opens the URL with
the platform command, and waits up to the server state's ten-minute lifetime.
The callback handler returns a fixed local success/failure page without tokens.

The CLI exchanges the code with the returned token endpoint using `net/http`
and form encoding. Control never receives the code or verifier. The CLI sends
the returned ID token to `ExchangeCLISession`; control uses the existing
bounded OIDC discovery/JWKS client with the provider's `cli_client_id`, verifies
the server-created nonce, and reuses the existing link/JIT/group/session logic.

### Database changes

- `identity_providers.cli_client_id text NOT NULL DEFAULT ''`.
- `auth_states.flow_kind text NOT NULL CHECK (flow_kind IN ('browser','cli'))`.
- Browser states retain the server-held verifier. CLI states leave
  `code_verifier` empty because the verifier never crosses the process
  boundary.

The SQLite baseline and sqlc queries are regenerated as one clean pre-alpha
cut. There is no forward/data migration or compatibility shim.

### CLI storage and transport

The CLI stores one current server and session below `os.UserConfigDir()` in a
`powermanage` directory. Access and refresh tokens are never command-line
arguments or environment variables. A Unix advisory lock serializes refresh;
session replacement is `0600` temp-write, sync, rename, and directory sync.
Public control requests use system TLS roots, bounded unary contexts, an 8 MiB
response/request ceiling, and the generated Connect client.

Resource commands share one generic helper constrained to a concrete generated
request type: read at most the control limit, `protojson.Unmarshal` with unknown
fields rejected, invoke one named generated method, and `protojson.Marshal` the
response. The helper is not a generic RPC surface and cannot select an RPC from
user input.

### New dependencies

- `github.com/spf13/cobra` in the SDK module. It is the operator-approved CLI
  command framework and supplies the explicit nested command/help model. No
  other new runtime dependency is needed.
- OAuth URL/form handling, PKCE, loopback HTTP, browser launching, credential
  files, and ProtoJSON use the Go standard library or existing protobuf/x/sys
  dependencies. In particular, no YAML, OAuth client, browser, or keyring module
  is added.

## Security considerations

- **Credential boundary:** state comparison, authorization code, PKCE verifier,
  and all IdP access/refresh tokens stay in the CLI. Control receives the ID
  token assertion because it must independently authenticate the subject, then
  mints its own session.
- **Public-client binding:** control verifies signature, issuer, CLI-client
  audience, nonce, provider, expiry, state kind, and one-use consumption. A
  valid token for the browser client or another provider is not interchangeable.
- **Loopback:** only literal `127.0.0.1` redirect hosts are accepted in v1. The
  listener binds before the login URL is issued. State mismatch stops before
  token exchange.
- **Secrets:** bootstrap, provider secret, OIDC code/verifier/tokens, and Power
  Manage refresh token never enter logs or audit evidence. Resource output may
  intentionally contain a newly created enrollment token exactly once.
- **Authorization:** new login RPCs are public but rate-limited. Every resource
  command relies on the existing authenticated interceptor and handler-level
  permission/scope checks; the CLI adds no bypass or client-side substitute.
- **Hostile input:** callback query values, token endpoint responses,
  ProtoJSON, file sizes, URLs, state/challenge/token lengths, file permissions,
  and server output are bounded and validated. Errors never print token endpoint
  bodies or credentials.
- **Audit:** begin-login is an anonymous background write; exchange is a login
  mutation; rejected exchanges are rejected-authentication operations. Existing
  resource mutation auditing remains unchanged.

## Test requirements

### Contract and generated-client tests

- Descriptor tests pin exactly two new RPCs and the provider capability fields.
- Reflection-driven validation coverage proves every new request field has a
  rule and drives correct/absent/wrong forms through real handlers.
- Generated Go and TypeScript clients are regenerated and drift-clean.

### Server handler tests

- Real local OIDC discovery/JWKS/token doubles exercise CLI begin and ID-token
  exchange, including a byte-tampered signature and independently constructed
  wrong audience/nonce/provider/issuer tokens.
- Provider create/update tests cover CLI-only, browser-only, both, neither,
  secret-without-browser-ID, clearing a browser client/secret, and public
  capability output.
- Begin tests cover correct loopback/challenge and every redirect/challenge/
  provider rejection. Stored rows prove CLI kind, empty verifier, nonce, expiry,
  and one-use behavior.
- Exchange tests prove link/JIT/group/default-role/session behavior, browser/CLI
  state separation, replay/expiry, disabled subject/provider, audit success,
  rejected audit, and forced-audit rollback.
- Existing browser SSO and bootstrap suites remain green.

### CLI tests

- `httptest` Connect and OIDC token endpoints drive the real Cobra command with
  injected clock, browser opener, config directory, and loopback listener.
- Login tests inspect the token form and prove no secret/code/verifier/IdP token
  reaches control, wrong callback state stops locally, and session persistence
  has strict permissions and atomic replacement.
- Refresh tests run concurrent processes/helpers against one session and prove
  one rotation, correct retry-on-expiry, no retry on other errors, and no lost
  replacement token.
- ProtoJSON tests use independent request fixtures for valid, absent, wrong,
  unknown, malformed, oversized, file, and stdin cases; spies prove every local
  rejection made zero RPCs.
- Each resource command reaches its real generated method and outputs a
  round-trippable response. Enrollment creation proves the secret is printed
  once and absent from subsequent get/list output.
- Bootstrap output/pipe tests capture stdout/stderr and prove the token appears
  only at its explicit source and header sink.

## Rejection paths

| Scenario | Error/status | Client-visible result | Logged context |
|---|---|---|---|
| Server URL is unsafe or malformed | local usage error | safe validation text | none |
| ProtoJSON missing/malformed/unknown/wrong/oversized | local usage error | safe parse/size text, no partial JSON | none |
| Credential path is symlinked or permissions are broad | local security error | credentials refused | path only |
| Bootstrap stdin empty/oversized | local usage error | bootstrap token refused | none |
| Bootstrap token invalid/spent/expired | `Unauthenticated` | invalid token | credential fingerprint only in server audit |
| Provider has neither client mode | `InvalidArgument` | provider needs a browser or CLI client | provider ID/operation after authentication only |
| Disabled or absent provider at public login | `NotFound` | identity provider not found | safe provider ID internally |
| Provider lacks CLI client | `FailedPrecondition` | CLI login is not configured | provider ID |
| Redirect is non-loopback, non-HTTP, or contains unsafe components | `InvalidArgument` | invalid CLI redirect | request ID, no query values |
| PKCE challenge malformed | `InvalidArgument` | invalid PKCE challenge | request ID only |
| Callback OAuth error, missing code, or wrong state | local authentication error | sign-in failed | no credential values |
| Token endpoint timeout/non-2xx/oversized/malformed/no ID token | local authentication error | identity provider exchange failed | endpoint host/status only |
| CLI state expired/spent/wrong kind/provider | `Unauthenticated` | could not sign in | state digest/provider ID |
| ID token signature/issuer/audience/nonce invalid | `Unauthenticated` | could not sign in | provider ID and reason class, never token |
| Subject disabled/unlinked and JIT unavailable | `Unauthenticated` | contact administrator | provider ID/reason class |
| Session refresh invalidated/replayed | `Unauthenticated` | run `powermanage login` again | existing rejected-session audit |
| Resource permission absent | `PermissionDenied` | permission denied | existing authorization audit |
| Scoped resource not visible | `NotFound` | resource not found | existing scoped audit |
| Logout cannot reach control | local/network error | session retained for retry | server host/error class |

## Rollout and migration

This is a clean pre-alpha contract/schema cut. SDK/contract lands first, server
pins it and implements the two RPCs, then the CLI and documentation ship from
the SDK repository. Operators register a native/public OIDC client with a
loopback redirect. IdPs that require an exact port use
`powermanage login --callback-port <port>`; otherwise the CLI uses an ephemeral
port.

Before tests begin, the approved target design's identity section is amended to
make bootstrap client-neutral and to record native/public CLI OIDC with local
callback, local PKCE/code exchange, and control-side ID-token verification.

## References

- Power Manage target design, sections 2 and 5.2.
- OAuth 2.0 Authorization Code with PKCE and OIDC Core ID-token verification.
- Existing specs 2 (enrollment tokens), 11 (SDK), and 29 (SSO hardening).
