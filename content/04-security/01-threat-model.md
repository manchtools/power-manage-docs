---
title: Threat model
---
# Threat model

Eight trust boundaries. The list below is what each one is, then what it actually buys you when something on the other side gets compromised.

## Boundaries

<!-- docref: begin src=server:internal/auth/interceptor.go#AuthInterceptor:82574866,server:internal/auth/interceptor.go#AuthzInterceptor:1682f36d,server:internal/auth/interceptor.go#RateLimiters:599a057d -->
1. **Web or CLI to control RPC.** HTTPS plus JWT bearer. The auth interceptor and per-procedure rate limits run first; the authz interceptor enforces permission gates.
<!-- docref: end -->
<!-- docref: begin src=server:internal/scim/handler.go#NewHandler:84400ff5,server:internal/scim/auth.go#Handler.withAuth:5cd524d7 -->
2. **SCIM IdP to SCIM endpoint.** Bcrypt-hashed bearer token per provider slug. Rate limits bucket on the slug (100/min) and on slug + client IP (20/min), applied *before* the bcrypt compare so token guessing can't be turned into a CPU DoS.
<!-- docref: end -->
<!-- docref: begin src=server:internal/idp/oidc.go#OIDCProvider.VerifyAndExtractClaims:abea947e,server:internal/idp/state.go#CodeChallengeS256:59390ddd,server:internal/api/sso_handler.go#validateSSORedirectURL:74b691ab -->
3. **SSO IdP to OIDC callback.** PKCE (S256) plus state and nonce validation. Any client-supplied `redirect_url` is checked server-side: it must be same-origin with the configured callback base URL (loopback URLs are allowed for CLI flows), everything else is refused.
<!-- docref: end -->
<!-- docref: begin src=server:internal/mtls/mtls.go#NewTLSConfig:4e33a1ed,server:internal/handler/agent.go#MTLSMiddleware:c507fa5e -->
4. **Agent to gateway.** mTLS with `RequireAndVerifyClientCert` (TLS 1.3 minimum), a SPIFFE peer-class SAN check, and a fail-closed revocation check against the CRL.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/deviceauth/enroll_server.go#EnrollSocketPath:9838543e,agent:internal/deviceauth/enroll.go#EnrollHandler.Enroll:20f2e054 -->
5. **Agent enrolment.** Local Unix socket `/run/pm-agent/enroll.sock`. Registration-token gated and rate limited to 5 attempts per minute.
<!-- docref: end -->
<!-- docref: begin src=server:internal/mtls/peer_class.go#RequirePeerClassNotRevoked:a56afe56,sdk:proto/pm/v1/internal.proto#InternalService:8786ba93 -->
6. **Gateway to control InternalService.** Internal mTLS proxy for credential-bearing operations (LUKS keys, LPS passwords). The listener requires the `gateway` peer class and rejects revoked certs — an agent cert, even a valid one, cannot reach it.
<!-- docref: end -->
<!-- docref: begin src=server:internal/taskqueue/sign.go#Signer.Wrap:2248192e,server:internal/taskqueue/sign.go#Signer.VerifyMiddleware:8511fb71 -->
7. **Control to and from Asynq / Valkey.** Every task payload is HMAC-signed with `PM_TASK_SIGNING_KEY`. The consumer verifies (constant-time) before handing off to its handler.
<!-- docref: end -->
<!-- docref: begin src=server:internal/crypto/crypto.go#NewEncryptor:1f25da9e,server:internal/crypto/crypto.go#Encryptor.EncryptWithContext:9ebf6086 -->
8. **Control to Postgres.** sqlc-generated queries. Secrets at rest go through AES-256-GCM with `CONTROL_ENCRYPTION_KEY`, every ciphertext AAD-bound to its row context (single `enc:v1` format, spec 20 — retired unbound formats fail loudly).
<!-- docref: end -->

## What stays safe when something gets compromised

The layers are stacked so no single compromise gives an attacker arbitrary action execution.

A compromised **Valkey/Redis** can't forge a dispatch. The HMAC envelope catches it before the gateway forwards.

<!-- docref: begin src=server:internal/actionparams/sign_envelope.go#BuildAndSignEnvelope:ae868e64,agent:internal/executor/executor.go#Executor.VerifyEnvelope:ea44180f -->
A compromised **gateway** can't forge a dispatch the agent will run — and can't *alter* one either. The CA signature covers the full action envelope (id, type, params, desired state, timeout, schedule, target device), signed at the control server and verified fail-closed by the agent over the exact bytes it executes. Terminal session start is the documented exception — see [Remote terminal access](/security/terminal-access).
<!-- docref: end -->

<!-- docref: begin src=server:internal/api/sso_handler.go#validateSSORedirectURL:74b691ab -->
A compromised **OIDC provider** can't pin a session to an attacker-controlled redirect URL. The server-side same-origin check refuses, independent of whatever the IdP validates.
<!-- docref: end -->

<!-- docref: begin src=server:internal/api/token_handler.go#TokenHandler.CreateToken:9e712a3f,agent:cmd/power-manage-agent/cert_rotation.go#renewAt:211ccaeb,server:internal/api/certificate_handler.go#CertificateHandler.renewLocked:9f5fb368 -->
A leaked **registration token** is bounded: self-service tokens are forced single-use with a 7-day expiry; operator-created tokens carry whatever one-time/max-uses/expiry limits the operator set. The certificate it provisions is identity-bound (fingerprint pinned in the DB, key-continuity enforced on renewal) and rotated at 80% of its lifetime, with the superseded cert revoked.
<!-- docref: end -->

<!-- docref: begin src=server:internal/crl/crl.go#Cache:7fdc8bfa,server:cmd/gateway/main.go#loadInitialCRL:e41a48d5 -->
A **stolen device cert** stops working when its device is deleted or its cert is superseded: the gateway consults a Valkey-backed CRL on every connection, fails closed while the list is unloaded, and refuses to boot without an initial CRL load.
<!-- docref: end -->

See [mTLS and signed actions](/security/mtls) and [Asynq task signing](/security/task-signing) for the cryptographic details.
