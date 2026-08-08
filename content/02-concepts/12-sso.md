---
title: SSO (OIDC)
---
# SSO / OIDC login

OIDC is the only human login mechanism. SCIM is the provisioning mechanism.
Power Manage has no local passwords, local accounts, TOTP, or WebAuthn.

## Bootstrap

A host-authorized `bootstrap-admin` command emits a short-lived, single-use
URL and bearer token. Use it only to configure the first OIDC/SCIM integration
and establish a real administrator. Its reserved principal is not a normal user
and can never satisfy `:self`.

## Login flow

### Browser client

1. The client requests an authorization URL for a configured provider.
2. Control creates one-shot state, nonce, and PKCE material with a short
   expiry.
3. The identity provider authenticates the user.
4. Control consumes the state atomically, verifies the ID token, audience,
   nonce, and provider identity, then issues the application session.

Redirect URLs are allowlisted. OIDC discovery, token exchange, and JWKS fetches
use bounded network timeouts.

### Native CLI client

<!-- docref: begin src=server:internal/identity/sso.go#Handlers.BeginCLILogin:f2f124f8,server:internal/identity/sso.go#Handlers.ExchangeCLISession:9a08d920 -->
The [operator CLI](/get-started/operator-cli) uses a public OIDC client and a
literal `127.0.0.1` callback. It creates the PKCE verifier and exchanges the
authorization code directly with the identity provider. Control creates and
consumes the one-shot state and nonce, verifies the returned ID token against
the CLI client audience, then issues the ordinary application session.

Browser and CLI login states cannot be used across the two flows.
<!-- docref: end -->

## Linking and provisioning

An existing provider-subject link wins. Optional email linking requires a
verified email assertion. Optional auto-creation makes an OIDC-provisioned
user; SCIM may create, update, disable, and group users according to the
configured provider policy.

OIDC client secrets are encrypted at rest with resource-context AAD and never
returned by read APIs. Login, linking, provisioning, rejection, and
deprovisioning operations are audited without recording secret values.
