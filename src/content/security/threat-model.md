# Threat model

There are eight trust boundaries. Each one is documented and tested.

## Boundaries

1. **Web or CLI to control RPC.** HTTPS plus JWT bearer. The auth interceptor and per-procedure rate limits run first; the authz interceptor enforces permission gates.
2. **SCIM IdP to SCIM endpoint.** Bcrypt-hashed bearer token per provider slug. Rate limits bucket on IP and slug.
3. **SSO IdP to OIDC callback.** PKCE plus state and nonce validation. Any client-supplied `redirect_url` is checked against the server-configured allowlist.
4. **Agent to gateway.** mTLS with `RequireAndVerifyClientCert` and a SPIFFE peer-class SAN check.
5. **Agent enrolment.** Local Unix socket `/run/pm-agent/enroll.sock`. Registration-token gated and rate limited.
6. **Gateway to control InternalService.** Internal mTLS proxy for credential-bearing operations (LUKS keys, LPS passwords).
7. **Control to and from Asynq / Valkey.** Every task payload is HMAC-signed with `PM_TASK_SIGNING_KEY`. The consumer verifies before handing off to the agent stream.
8. **Control to Postgres.** sqlc-generated queries. Secrets at rest go through AES-GCM with `CONTROL_ENCRYPTION_KEY`.

## What each boundary buys you

The layers are stacked so no single compromise hands an attacker arbitrary action execution:

- A compromised **Valkey** can't forge a dispatch. The HMAC envelope catches it before the gateway forwards.
- A compromised **gateway** can't forge a dispatch the agent will run. The CA signature on the action stops at the agent's verifier.
- A compromised **OIDC provider** can't pin a session to an attacker-controlled redirect. The server-side allowlist refuses.
- A leaked **registration token** is single-use and short-lived. The cert it provisions is identity-bound and rotated at 80% of its lifetime.

See [mTLS and signed actions](/security/mtls) and [Asynq task signing](/security/task-signing) for the cryptographic details.
