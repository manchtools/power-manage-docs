# Threat model

Power Manage has eight trust boundaries. Each is documented + tested.

## Boundaries

1. **Web / CLI → Control RPC** — HTTPS + JWT bearer; auth-interceptor + per-procedure rate limits; AuthZ interceptor enforces permission gates.
2. **SCIM IdP → SCIM endpoint** — bcrypt-hashed bearer token per provider slug, IP + slug rate-limit buckets.
3. **SSO IdP → OIDC callback** — PKCE + state/nonce validation; client-supplied `redirect_url` validated against the server-configured callback base allowlist.
4. **Agent → Gateway** — mTLS with `RequireAndVerifyClientCert` and SPIFFE peer-class SAN enforcement.
5. **Agent enrolment** — local Unix socket `/run/pm-agent/enroll.sock`, registration-token-gated, rate-limited.
6. **Gateway → Control InternalService** — internal mTLS proxy for credential-bearing operations (LUKS keys, LPS passwords).
7. **Control ↔ Asynq/Valkey** — every task payload is HMAC-signed with `PM_TASK_SIGNING_KEY`; the consumer side verifies before dispatching to the agent stream.
8. **Control → Postgres** — sqlc-generated queries; secrets-at-rest encrypted via AES-GCM (`CONTROL_ENCRYPTION_KEY`).

## What each boundary guarantees

The defence-in-depth is deliberately stacked so a single compromise doesn't grant arbitrary action execution:

- A compromised **Valkey** can't forge a dispatch — the HMAC envelope catches it before the gateway forwards.
- A compromised **gateway** can't forge a dispatch the agent will execute — the CA-signed action signature stops at the agent's verifier.
- A compromised **OIDC provider** can't pin a session to an attacker's redirect — the server-side allowlist refuses.
- A leaked **registration token** is single-use and short-lived; the cert it provisions is identity-bound and rotated at 80% lifetime.

See [mTLS + signed actions](/security/mtls) and [Asynq task signing](/security/task-signing) for the cryptographic details of each.
