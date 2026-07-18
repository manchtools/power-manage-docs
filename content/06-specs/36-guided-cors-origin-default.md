---
title: "Guided setup CORS origin default"
status: draft
created: 2026-07-16
---

# Guided setup CORS origin default

## Overview

Make the reference server deployment usable by the separately hosted Power Manage web application on first boot. Guided setup asks for the browser web-app origin list, defaults to `https://app.power-manage.manchtools.com`, validates a bounded shell-safe canonical origin grammar, and persists the accepted comma-separated value as `CORS_ORIGINS` before Compose starts control.

## Motivation

The reference Compose stack does not host the web application. An empty `CONTROL_CORS_ORIGINS` therefore causes control's fail-closed CORS middleware to reject the browser application's cross-origin requests. `deploy/.env.example` mentions CORS, but `guided_setup()` never asks for or writes it, so a successful guided installation can produce a control server whose API is unreachable from the hosted web app.

## Acceptance criteria

1. Given a fresh guided setup with absent or empty `CORS_ORIGINS`, when
   the operator accepts the CORS prompt's default, then `.env` contains exactly
   `CORS_ORIGINS=https://app.power-manage.manchtools.com`.
2. Given absent or empty `CORS_ORIGINS`, when the operator enters a valid
   comma-separated custom origin list, then setup preserves the exact accepted
   list. Each entry is a canonical origin only: no whitespace, empty entry,
   userinfo, path, query, fragment, trailing slash, wildcard, or shell-significant
   character; the total and entry count are bounded.
3. Given invalid or non-canonical origin input, when the top-level installer
   runs, then each of the following holds as its own testable guarantee:
   a. the CORS prompt executes before the first guided `write_env_var`;
   b. setup rejects with `.env` byte-identical to the baseline captured after
      `init_env` and release-tag `IMAGE_TAG` handling, immediately before
      `run_setup`;
   c. the answer is never evaluated as shell input;
   d. no `docker compose pull` or `docker compose up` is invoked;
   e. a recording Docker stub proves the no-start result through the real
      installer entry point, not only by calling `guided_setup()` directly.
4. Given an existing `CORS_ORIGINS` assignment, when guided or non-interactive
   setup starts, then it extracts and validates that literal from raw `.env` bytes
   before the first `source`. A valid non-empty value is retained without
   replacement; duplicate, non-literal, malformed, or non-canonical assignments
   fail before shell evaluation.
5. Given `.env.example`, then `CORS_ORIGINS` remains empty (`CORS_ORIGINS=`) so
   guided setup still prompts, while the adjacent documentation names
   `https://app.power-manage.manchtools.com` as the guided default.
6. Given `CONTROL_SSO_CALLBACK_BASE_URL` is unset, when Control loads the guided
   CORS value, then its existing behavior deliberately uses the first configured
   CORS origin as the SSO callback base. An explicit callback-base value remains
   authoritative; custom multi-origin lists document that order matters.
7. Given the real deployment gate, when `install.sh` receives a blank answer at
   the real guided CORS prompt while the parent environment deliberately exports
   conflicting `CORS_ORIGINS` and `CONTROL_CORS_ORIGINS`, then each of the
   following holds as its own testable guarantee:
   a. the installer sanitizes both variables for every Compose invocation and
      the exact generated `.env` remains authoritative;
   b. Control's effective environment contains exactly
      `CONTROL_CORS_ORIGINS=https://app.power-manage.manchtools.com`;
   c. a real browser actor serving test code from the allowed origin performs
      the setup page's `fetch(<control>/health, {method: "GET", mode: "cors"})`
      successfully;
   d. the same browser actor uses the generated TypeScript SDK client from the
      reviewed `sdk_sha` for credentialless `ListAuthMethods`, real login, and
      one protected request with the issued admin JWT, and all succeed;
   e. supplemental raw probes assert the exact method-appropriate CORS header
      sets.
8. Given the same deployment, when the exact unlisted origin, the near-match
   `https://app.power-manage.manchtools.com.evil.example`, and an unlisted sibling
   subdomain each perform equivalent browser requests and raw preflight/actual
   probes, then the browser cannot read any response, every raw preflight returns
   403, and every raw actual method retains its method-specific non-CORS outcome.
   None returns an allow-origin/credentials/expose header. Cache variation remains
   explicit: denied actual responses have exactly `Vary: Origin`; denied
   preflights have exactly `{Origin, Access-Control-Request-Method,
   Access-Control-Request-Headers}`. Header names, method/header lists, and `Vary`
   tokens are compared as exact order-insensitive sets; ACL, connection, TLS, and
   service-log gates remain green.
9. Given the installer-level gate targets reviewed `server_sha`, when `install.sh`
   downloads its source archive, then the harness intercepts that download and
   supplies a tarball generated from exactly `server_sha`, verifies the extracted
   deploy-file digests against that commit, and forbids network fallback. A stale
   tag/branch archive or digest mismatch fails before setup or Compose.
10. Given the guided CORS prompt and the `.env.example` documentation, then both
    state, and a setup test asserts the emitted prompt text contains:
    a. the default is the **vendor-hosted** web-app origin, and accepting it
       grants credentialed cross-origin trust to a vendor-controlled origin —
       operators who self-host their own frontend should enter their own origin
       instead;
    b. with multiple origins, origin **order** selects the implicit SSO
       callback base (the first configured origin), and operators using SSO
       should set `CONTROL_SSO_CALLBACK_BASE_URL` explicitly to decouple it.

## Out of scope

- Hosting the web application in the server Compose stack.
- Wildcard CORS or `CONTROL_CORS_ALLOW_ALL` (development-only and fail-closed in production).
- Normalizing or silently repairing operator input. Non-canonical origins are
  rejected rather than rewritten.
- Replacing the deployment's general `source .env` configuration contract. Other
  manually edited keys remain trusted root-owned shell configuration. The one
  exception is `CORS_ORIGINS`: its raw assignment is parsed and validated before
  any source so this newly guided value cannot execute as shell syntax.
- Changing the server middleware's exact-match CORS semantics.

## Technical design

### Affected files

- `server/deploy/setup.sh` — add a non-executing raw `CORS_ORIGINS` extractor and
  `validate_cors_origins`. Both guided and non-interactive paths call them before
  the first `.env` `source`. Guided setup prompts/validates CORS before its first
  `write_env_var`, then persists through the existing writer; do not add a second
  env writer.
- `server/deploy/.env.example` — keep `CORS_ORIGINS` empty and document
  the hosted web-app value as the guided default plus the first-origin SSO rule.
- `server/deploy/setup_test.sh` — exercise real prompt→validation→file wiring,
  retention, rejection, and SSO-order documentation assumptions.
- `server/deploy/install.sh` plus an installer-level shell harness — intercept the
  archive download with a tarball generated from exact reviewed `server_sha`,
  verify extracted deploy-file digests, forbid network fallback, prove the
  production entry point invokes setup before any pull/up, compare invalid-input
  `.env` bytes from the post-`init_env`/pre-`run_setup` baseline, and clear inherited
  `CORS_ORIGINS` and `CONTROL_CORS_ORIGINS` for every Compose invocation.
- `server/internal/middleware/cors.go` and focused tests — set cache-correct `Vary`
  tokens before denied-origin returns while continuing to emit no CORS grant.
- `server/deploy/smoke-test.sh` / exhaustive deployment scenarios — run the real
  blank-answer guided install path with conflicting inherited CORS variables, boot
  from its exact generated `.env`, inspect Control's effective environment, and
  combine a real-browser actor using the generated TypeScript SDK from reviewed
  `sdk_sha` with supplemental raw probes for allowed and denied behavior through
  Traefik. Browser test source lives in `server_sha`; this adds no fourth release
  identity to spec 37's three-SHA change-set manifest.

### Input and runtime format

Before `guided_setup()` or `check_env()` sources `.env`, a line-oriented raw
reader inspects non-comment lines containing the exact token `CORS_ORIGINS`.
There may be zero or one assignment, and the only accepted form is the complete
single line `CORS_ORIGINS=<literal>` with no `export`, surrounding assignment
whitespace, quoting, continuation, or trailing command/comment. Duplicate
assignments or any non-comment use of the token outside that exact form fail
closed. The extracted literal is validated while still data; it is never passed
to `eval` or a shell parser. For this key only, the exact prompt-triggering set is
an absent assignment or the literal empty assignment `CORS_ORIGINS=`. The generic
`is_placeholder` substring rule is not used: `CHANGE_ME`, any value containing
`example.com`, and every other non-empty value must pass the full CORS validator or
fail. Non-interactive validation retains the existing normal configuration
contract.

Guided setup performs this raw check, prompts and validates CORS before sourcing
current values or calling any `write_env_var`, then continues with the existing
domain/secret prompts. A valid retained non-empty value causes no write.
A newly accepted value becomes the first guided write, so invalid CORS input
leaves the original `.env` byte-for-byte unchanged.

`validate_cors_origins` accepts 1–16 comma-separated entries and at most 2048
bytes total. Empty entries and all whitespace are rejected. Each entry is already
in browser-origin form and is persisted byte-for-byte:

- lowercase `https://` plus a canonical lowercase DNS/punycode hostname only,
  with an optional numeric non-default port 1–65535; HTTPS IP literals reject;
- lowercase `http://` only for the exact loopback hosts `localhost`, `127.0.0.1`,
  or `[::1]`, again with an optional non-default port;
- any explicit port is canonical decimal with no leading zero, in range 1–65535,
  and not the scheme default (`443` for HTTPS, `80` for HTTP);
- no userinfo, wildcard, path (including `/`), query, fragment, trailing dot,
  default port, control byte, quote, backslash, dollar, backtick, semicolon,
  ampersand, pipe, parenthesis, redirect, or other shell-significant syntax.

The helper uses pattern matching only; it never uses `eval` or re-sources the
operator's answer. This constrained grammar makes the existing unquoted
`KEY=value` writer safe for generated CORS values. Invalid input is rejected,
not normalized.

At runtime, `CONTROL_CORS_ORIGINS` continues to use `config.EnvCSV` and exact
string matching. Compose maps `CORS_ORIGINS` to `CONTROL_CORS_ORIGINS`. The narrow
Go middleware change moves cache-variation headers before the denied-origin return:
all origin-dependent actual responses carry `Vary: Origin`, and preflights also
carry `Access-Control-Request-Method` and `Access-Control-Request-Headers`, without
adding any allow-origin, credentials, expose, methods, headers, or max-age grant to
a denied response. Because Docker Compose gives the invoking process environment
precedence over its `.env`, `install.sh` invokes every `docker compose` command
with inherited `CORS_ORIGINS` and `CONTROL_CORS_ORIGINS` removed. The latter is
also cleared even though the current mapping ignores it, preventing future mapping
drift from silently reintroducing host authority. Other operator environment
variables retain the existing contract. When `CONTROL_SSO_CALLBACK_BASE_URL` is
absent, Control intentionally inherits the first parsed CORS origin. The prompt
and `.env.example` carry the AC 10 copy: the default is the vendor-hosted
origin and self-hosters should enter their own (accepting the default grants
credentialed cross-origin trust to a vendor-controlled origin), and multi-origin
order selects the default SSO redirect origin (the first configured origin), so
SSO operators should set `CONTROL_SSO_CALLBACK_BASE_URL` explicitly to decouple
it — a forgotten override would otherwise redirect OIDC authorization codes to
the vendor origin by default (bounded by the IdP-side redirect-URI allow-list).

### Proto, database, and dependencies

None.

## Security considerations

- Authorization: unchanged; CORS is a browser-origin gate, not authentication or authorization.
- Input validation: preserve the exact-origin allow-list and reject malformed,
  non-canonical, wildcard, or shell-unsafe prompt input before persistence. Do not
  add substring/suffix matching.
- Configuration execution: the raw CORS assignment is extracted and validated
  before the first `.env` source in every setup mode. Duplicate/non-literal uses
  fail before evaluation; prompt input never reaches `eval`. Inherited CORS
  variables are removed from Compose processes so parent-environment precedence
  cannot replace the validated file value. Other root-owned `.env` keys keep the
  existing trusted-shell contract.
- SSO redirect authority: the first CORS origin remains the implicit callback
  base only when no explicit callback base is configured. The order dependency
  is documented and tested rather than changed silently.
- Secrets: none.
- Audit: no state-changing RPC is added.
- Fail closed: an unlisted/near-match origin receives a 403 preflight, and its
  actual request receives no browser-readable CORS grant even when the underlying
  authenticated RPC succeeds; an invalid setup value prevents every Compose
  pull/up invocation.
- **Load-bearing invariant — Bearer-only authentication:** this entire design is
  safe *because* auth is Bearer-only with no ambient cookies. A denied-origin
  actual request still executes server-side; only the CORS read grant is
  withheld, which is harmless only while the browser holds no ambient credential
  to attach. Any future cookie- or session-based authentication change MUST
  revisit this spec's CORS model before shipping.

## Test requirements

### Setup regression tests

Run the real `guided_setup()` in an isolated temporary deployment. Use both a
fresh file with later prompt values unanswered and focused cases with later values
pre-seeded:

- Fresh invalid CORS input is the first prompt failure after installer
  initialization; capture the complete `.env` bytes/SHA-256 after `init_env` and
  release-tag `IMAGE_TAG` handling, immediately before `run_setup`, then prove the
  failure leaves that baseline unchanged and performs no domain/secret write.
  Invoke the production top-level `install.sh` entry point through an isolated
  installer harness with a recording `docker` executable first on `PATH`; assert
  its ledger contains neither `compose pull` nor `compose up`. Calling
  `guided_setup()` or `setup.sh` alone does not satisfy this assertion.
- The installer harness creates the downloaded archive with `git archive` from the
  exact reviewed `server_sha`, intercepts both tag/branch download URLs, rejects
  any network fallback, and compares extracted `install.sh`, `setup.sh`, Compose,
  and environment-template digests to that commit before invoking the installer.
- In a valid blank-answer installer run, export conflicting parent
  `CORS_ORIGINS` and `CONTROL_CORS_ORIGINS`; the recording Docker stub captures
  each Compose process environment and proves both are absent while the generated
  `.env` retains the hosted default.
- Blank answer writes the exact hosted default as the first guided write;
  `.env.example` itself remains empty so this prompt is reached.
- Valid single and multi-origin answers are preserved exactly, including a
  non-default port; an existing valid custom list is retained.
- Table-driven wrong cases cover whitespace, empty entries, uppercase/noncanonical
  host, HTTPS IPv4/IPv6 literals, wildcard, path/trailing slash, query, fragment,
  userinfo, default/out-of-range/leading-zero port, unsupported cleartext host,
  overlong/too-many entries, and shell syntax such as `$()`, backticks, quotes,
  semicolon, ampersand, pipe, redirect, and newline. Each fails before `.env`
  changes and no marker command executes. Exact trigger tests prove only an
  absent assignment or literal empty assignment prompts; `CHANGE_ME`,
  `https://app.example.com`, and an arbitrary value merely containing
  `example.com` are validated, never silently replaced.
- Existing invalid/non-literal values fail before the first source in guided and
  non-interactive modes. Cover duplicate assignments, `export`, assignment
  whitespace/quotes, trailing shell text, and `$(touch "$marker")`; the marker is
  absent and `.env` is unchanged. Every retained-assignment rejection also runs
  through the top-level installer ledger and proves no Compose pull/up.
- Inject failure in the existing atomic writer's temp-file/rename path. Setup
  returns non-zero, the original `.env` remains byte-identical, no partial temp
  content becomes authoritative, and the installer invokes no Compose pull/up.
- With callback base unset, a config-level test proves Control selects the first
  parsed origin; an explicit callback base wins.
- The emitted guided CORS prompt text contains both AC 10 statements — the
  vendor-default/self-host-your-own recommendation and the
  origin-order-selects-SSO-callback steer toward
  `CONTROL_SSO_CALLBACK_BASE_URL` — asserted on stable key phrases, and
  `.env.example` carries the same two notes adjacent to `CORS_ORIGINS=`.

### Middleware regression tests

- A denied actual-origin request reaches the wrapped handler, emits no CORS grant
  headers, and carries exactly `Vary: Origin`.
- A denied preflight returns 403 before the wrapped handler, emits no grant/method/
  header/max-age fields, and carries exactly `{Origin,
  Access-Control-Request-Method, Access-Control-Request-Headers}` in `Vary`.
- Existing allowed preflight/actual and no-Origin behavior retain their exact header
  contracts. Each scenario has its own test function; no substring assertions.

### Deployment integration test

The deployment test proves the real configuration chain rather than injecting
the final container value:

1. Generate the install archive from exact reviewed `server_sha`, intercept both
   installer download URLs with that archive, forbid network fallback, and verify
   the extracted deploy-file digests. Pre-seed only unrelated guided answers,
   export conflicting host/workflow values for both `CORS_ORIGINS` and
   `CONTROL_CORS_ORIGINS`, then run the real top-level `install.sh` flow with a
   blank CORS answer and retain the exact generated `.env`. The installer removes
   both inherited variables for every Compose process. Boot the real stack and
   inspect Control's effective environment; it contains exactly
   `CONTROL_CORS_ORIGINS=https://app.power-manage.manchtools.com`, proving the file
   rather than the parent shell supplied the value.
2. From a page served at the allowed origin, a real browser performs the setup
   page's CORS-mode `GET /health`, then imports the generated TypeScript client from
   exact reviewed `sdk_sha` and successfully calls credentialless
   `ListAuthMethods`, performs real login, and calls one protected method with the
   issued admin JWT. Browser console/network failures fail the gate.
3. Supplemental raw preflight sends
   `Origin: https://app.power-manage.manchtools.com`,
   `Access-Control-Request-Method: POST`, and
   `Access-Control-Request-Headers: Authorization, Content-Type,
   Connect-Protocol-Version`. Assert HTTP 204 and these exact CORS values:
   `Access-Control-Allow-Origin` is the origin,
   `Access-Control-Allow-Credentials` is `true`, allow-methods is the
   order-insensitive set `{GET, POST, PUT, DELETE, OPTIONS}`, allow-headers is
   `{Accept, Authorization, Content-Type, Connect-Protocol-Version,
   Connect-Timeout-Ms}`, expose-headers is `{Connect-Content-Encoding,
   Connect-Protocol-Version}`, max-age is `86400`, and `Vary` is exactly
   `{Origin, Access-Control-Request-Method, Access-Control-Request-Headers}`.
4. Supplemental raw credentialless and authenticated Connect JSON requests assert
   each method's success and the exact actual-response CORS set: reflected
   allow-origin, credentials `true`, expose-headers above, and `Vary: Origin`, with
   preflight-only headers absent. These probes diagnose exact headers but do not
   substitute for the browser actor.
5. For `https://unlisted.example`,
   `https://app.power-manage.manchtools.com.evil.example`, and an unlisted sibling
   subdomain, the browser must be unable to read `/health` or generated-client
   responses. Equivalent raw preflights are HTTP 403; raw actual POSTs retain their
   expected method result. Neither carries allow-origin, credentials, or expose
   headers. Denied actual `Vary` is exactly `{Origin}` and denied preflight `Vary`
   is exactly `{Origin, Access-Control-Request-Method,
   Access-Control-Request-Headers}`.
6. Compare repeated/list-valued headers as exact case-insensitive,
   order-insensitive sets, not substring containment, then continue through the
   complete service health, ACL, TLS, connection, and log gate.

## Rejection paths

| Scenario | Error code | Operator-visible result | Logged context |
|----------|------------|-------------------------|----------------|
| Operator accepts blank input | N/A | The default hosted web-app origin is written | Existing guided setup completion log |
| Operator enters valid custom origins | N/A | Exact accepted value is written; first origin is identified as implicit SSO base when no override exists | Safe origin list only |
| Prompt value is malformed/noncanonical/shell-unsafe | Shell non-zero | Fails at the first guided prompt, leaves `.env` byte-identical to the post-`init_env`/pre-`run_setup` baseline, and invokes no Compose pull/up | Invalid entry/category and recording-Docker ledger only; no evaluated value or secret data |
| Retained assignment is duplicate, non-literal, malformed, or noncanonical | Shell non-zero before first source | Setup refuses to evaluate `.env`; file remains unchanged and Compose does not start | Assignment category/line number, never evaluated value |
| Downloaded archive is not exact reviewed `server_sha`, digest check fails, or interception would fall back to network | Installer assertion failure before setup | Candidate is rejected; no Compose invocation | Expected/observed commit and deploy-file digest only |
| Existing valid non-empty value is present | N/A | Raw value is validated before source and retained without rewrite | No additional per-origin request log |
| Parent environment supplies either CORS variable to Compose | Installer assertion/test failure | Validated `.env` authority was bypassed; stack start is not accepted | Variable name and Compose stage only, not unrelated environment values |
| `.env` temp write or atomic rename fails | Shell non-zero | Setup aborts, original file remains byte-identical, and no Compose pull/up runs | Shell/file operation category only |
| Allowed browser flow fails, or a raw public/protected request has any missing/extra CORS header/token | Deployment assertion failure | Browser contract is not accepted as proven | Browser stage plus exact normalized expected/observed header sets; no bearer token |
| Browser origin is unlisted, an allow-list suffix near-match, or an unlisted sibling | Browser CORS failure; raw HTTP 403 preflight; actual method keeps its own result but has no CORS grant | Browser cannot read the response | Origin category, status, exact absent grant headers, and cache-correct `Vary` set; no bearer token |

## Rollout and migration

Fresh guided deployments receive the hosted application origin by default.
Existing deployments keep any valid canonical configured list. A rerun rejects a
previously tolerated non-canonical list (for example whitespace or a trailing
slash) and asks the operator to rewrite it explicitly; setup never silently
normalizes security configuration. Existing explicit
`CONTROL_SSO_CALLBACK_BASE_URL` values remain unchanged. Operators with multiple
web origins place the intended default SSO origin first or set the callback base
independently.

## References

- `server/internal/middleware/cors.go` — fail-closed origin enforcement.
- `server/internal/config/env.go` — CSV parsing.
- `server/deploy/compose.yml` — `CORS_ORIGINS` to `CONTROL_CORS_ORIGINS` mapping.
- `server/deploy/setup.sh` — current guided writes and both `.env` source sites.

## Audit findings (2026-07-18)

Pre-implementation review — **the proposed CORS default is safe.** The default is a
single static HTTPS origin matched by exact full-string comparison (not `*`, not
Origin reflection, not a Host-derived / spoofable value), credentialed CORS is
granted only to that exact origin, empty config fails closed (allow-none), and the
WS5 allow-all-no-credentials guard, the production boot-refusal of
`CONTROL_CORS_ALLOW_ALL`, and the WS13 Cookie-omission / Bearer-only model are all
preserved. The middleware delta is pure cache-correctness hardening (`Vary` on denied
responses). Three notes to fold in before implementation:

- **[Low→Medium] Origin order selects the SSO callback authority.** When
  `CONTROL_SSO_CALLBACK_BASE_URL` is unset, `SSOCallbackBaseURL = CORSOrigins[0]`
  ([flags.go:105-106](../../../server/cmd/control/flags.go)). A self-hosted SSO
  operator who forgets to set it gets OIDC authorization codes redirected to the
  *vendor* origin by default (mitigated by the IdP-side redirect-URI allow-list). Fix:
  the guided prompt must state that origin order selects the SSO redirect target and
  steer SSO operators to set `CONTROL_SSO_CALLBACK_BASE_URL` explicitly.
- **[Low] The default delegates credentialed cross-origin trust to a vendor-controlled
  origin** (`app.power-manage.manchtools.com`) even for operators who self-host their
  own frontend. Bounded by Bearer-only auth (no ambient cookie/token to steal) and
  operator-overridable. Fix: prompt copy recommending self-hosters enter their own
  origin.
- **[Info] The whole design is safe *because* auth is Bearer-only with no ambient
  cookies.** Add one Security-considerations line naming this as a load-bearing
  invariant, so any future cookie-auth change is forced to revisit CORS (the
  denied-origin actual request still executes server-side; only CORS read headers are
  withheld).

Also atomize the compound ACs (3, 7 bundle installer-digest, `.env` byte-identity,
Docker-stub, and header assertions into one criterion).

### Remediation (2026-07-18, WS-E amendment)

- **SSO callback order (Low→Medium)** → AC 10b + prompt/`.env.example` copy +
  a setup test asserting the emitted prompt text: origin order selects the
  implicit SSO callback base; SSO operators are steered to set
  `CONTROL_SSO_CALLBACK_BASE_URL` explicitly.
- **Vendor-origin default trust (Low)** → AC 10a + the same copy/test:
  self-hosting operators are told to enter their own origin because the default
  grants credentialed cross-origin trust to a vendor-controlled origin.
- **Bearer-only invariant (Info)** → Security considerations now names
  Bearer-only/no-ambient-cookie auth as the load-bearing invariant; any future
  cookie-auth change must revisit this spec's CORS model before shipping.
- **Non-atomic ACs** → ACs 3 and 7 decomposed into lettered single-guarantee
  sub-criteria.
