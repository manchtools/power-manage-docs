---
title: Operator CLI
---
# Operator CLI

The open-source `powermanage` command lets an operator bootstrap OIDC, sign in,
and use the control API without the hosted web application.

Install it from the SDK module, then set the control-server URL. Production
URLs must use HTTPS; literal loopback HTTP is accepted for local development.

```bash
go install github.com/manchtools/power-manage-sdk/cmd/powermanage@v0.5.4-0.20260808183110-41889787d778
powermanage config set-server https://control.example
```

The first release supports Unix-like operator workstations; Windows support is
out of scope.

## Bootstrap OIDC

Register a public/native OIDC client at your identity provider with a loopback
redirect such as `http://127.0.0.1:8400/callback`. Write the provider request in
the API's ProtoJSON format:

```json
{
  "name": "Company OIDC",
  "slug": "company",
  "providerType": "IDENTITY_PROVIDER_TYPE_OIDC",
  "cliClientId": "powermanage-cli",
  "issuerUrl": "https://idp.example",
  "autoCreateUsers": true,
  "defaultRoleId": "00000000000000000000000001"
}
```

<!-- docref: begin src=server:cmd/control/bootstrap_admin.go#writeBootstrapAdminOutput:665c9c92,sdk:cmd/powermanage/main.go#app.bootstrapCommand:2cb480ba -->
On the control host, pipe the single-use bootstrap token directly to the CLI:

```bash
control bootstrap-admin --output token \
  | powermanage bootstrap oidc --file provider.json --token-stdin
```

The CLI spends the token only on provider creation and does not store it.
<!-- docref: end -->

## Sign in

<!-- docref: begin src=sdk:cmd/powermanage/main.go#app.login:d1bd9b1f,server:internal/identity/sso.go#Handlers.BeginCLILogin:f2f124f8,server:internal/identity/sso.go#Handlers.ExchangeCLISession:9a08d920 -->
```bash
powermanage login --provider company --callback-port 8400
powermanage whoami
```

The CLI binds `127.0.0.1`, owns the PKCE verifier, checks the callback state,
and exchanges the authorization code directly with the identity provider.
Control receives the signed ID token for verification, but not the code,
verifier, or IdP access and refresh tokens.
<!-- docref: end -->

<!-- docref: begin src=sdk:cmd/powermanage/main.go#app.authCommand:1a215758 -->
`powermanage auth token` prints only the server URL, short-lived Power Manage
access token, and expiry for local Terraform exec credentials. It never prints
the Power Manage refresh token.
<!-- docref: end -->

## Operate resources with ProtoJSON

<!-- docref: begin src=sdk:cmd/powermanage/main.go#app.actionCommand:0f1ceb3a,sdk:cmd/powermanage/main.go#app.assignmentCommand:64cc0d6b,sdk:cmd/powermanage/main.go#app.enrollmentTokenCommand:6b70d562 -->
Create commands accept their generated request message as strict ProtoJSON
from a file or stdin, and responses are ProtoJSON too.

```bash
powermanage action create --file create-action.json
powermanage action get 01K...
powermanage action list

powermanage assignment create --file create-assignment.json
powermanage assignment list

powermanage enrollment-token create --file create-token.json
powermanage enrollment-token list
powermanage enrollment-token disable 01K...
```

Enrollment-token creation prints the bearer value and CA fingerprint once.
Later `get` and `list` calls cannot recover that bearer value.
<!-- docref: end -->

Use `--file -` to read a request from stdin. YAML is not supported: the CLI
uses the existing API format directly.
