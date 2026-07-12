---
title: "Datastore authentication hardening (Valkey + Postgres)"
status: draft
created: 2026-07-12
---

# Datastore authentication hardening (Valkey + Postgres)

## Overview

Power Manage leans heavily on Valkey (task queue, CRL, gateway routing
registry, Traefik route KV, search index) and Postgres (event store +
projections). Today both are protected by a **single shared password** each and
run **cleartext** on the wire:

- **Valkey**: one `requirepass` secret shared by control, gateway, indexer, and
  the internet-facing **Traefik**; no ACLs (every client has full access); no
  TLS (`bind 0.0.0.0`, `protected-mode no`).
- **Postgres**: password auth with `sslmode=disable` on both the control and
  indexer connection URLs.

Passwords themselves are *strong* — `deploy/setup.sh` auto-generates each with
`openssl rand -base64 32` and rejects `CHANGE_ME*` placeholders. The weakness is
**structural**: one all-access credential per datastore and unencrypted
transport. On the single-host reference compose the datastores are on an
internal Docker network with no published ports, which contains the blast
radius. But the multi-instance-control and multi-gateway topology from
[spec 31](31-gateway-enrollment-and-control-ha.md) spreads components across
hosts — the internal network spans the host boundary, and shared-credential +
cleartext becomes a real exposure. **This spec makes datastore access
least-privilege and encrypted, so scaling out is safe.**

Because [spec 31](31-gateway-enrollment-and-control-ha.md) ships **first**, its
CA is already issuing per-component certificates when this spec lands — so there
is no reason to phase a "CA-free tier" ahead of an "mTLS tier." This spec goes
**straight to mutual TLS** for both datastores, in one step:

- **Transport + client identity: mutual TLS.** Valkey `tls-auth-clients yes` and
  Postgres `hostssl … cert clientcert=verify-full`, verified against the spec-31
  CA. Every datastore connection must present a CA-signed client cert; a stolen
  password alone is useless.
- **Authorization: least-privilege, kept.** mTLS answers *who are you*, not
  *what may you touch* — so the per-service **Valkey ACLs** (Traefik read-only,
  namespace isolation, destructive-command denial) and the **Postgres role
  model** remain, layered on top of mTLS. Postgres maps the cert `CN` → DB role
  and drops passwords entirely; Valkey keeps per-user ACL secrets for user
  *selection* behind the cert-gated transport.

Client certs for the components: gateways already get one from spec-31
enrollment (reused here); **control and indexer** get CA-signed client certs
issued by `setup.sh` (which holds the CA key) — no new enrollment path needed.

## Motivation

- **One leaked credential = full datastore.** Any component that leaks the
  shared Valkey password gives an attacker the entire keyspace: reroute the
  gateway mTLS passthrough (Traefik keys), poison the CRL (which spec 31 makes
  agent-trusted), read/delete every queue. Least-privilege ACLs contain a
  single-component compromise to that component's blast radius.
- **The Traefik blast radius flagged in spec 29 is still open.** Traefik holds
  the *full* Valkey password (`--providers.redis.password=${VALKEY_PASSWORD}`)
  **and** carries the Docker-socket exposure documented in
  [deployment hardening](../04-security/08-deployment-hardening.md). A
  compromised Traefik today gets full Valkey. A **read-only, `traefik/*`-only**
  ACL user reduces that to read-only route discovery — no passthrough rewrite,
  no CRL/queue access. This is the single highest-value change here.
- **Cleartext breaks under HA.** `sslmode=disable` and plaintext Valkey are
  inert behind a single-host internal network but expose credentials and all
  data the moment control/gateway replicas talk to the datastores across hosts —
  exactly the topology spec 31 enables.
- **Defense in depth, not redundancy.** The spec-29 task-HMAC *assumes* Valkey
  can be compromised and signs around it. This spec attacks the *likelihood* of
  that compromise. Both layers are needed.

## Acceptance criteria

All criteria depend on spec 31's CA (client certs). Grouped by concern:
authorization (ACLs / roles) and authentication (mutual TLS).

### Valkey — least privilege (ACLs)

1. Given the reference deploy, when it is provisioned, then the single shared
   `VALKEY_PASSWORD` is replaced by **per-service ACL users** (`pm-control`,
   `pm-gateway`, `pm-indexer`, `pm-traefik`), each authenticating with its own
   crypto-strong password, defined in `valkey.conf`.
2. Given the `pm-traefik` ACL user, when it issues any command, then it is
   restricted to **read-only access on `~traefik/*`** plus only the commands
   Traefik's Redis provider needs; any write, any other keyspace, or any admin
   command is **denied by Valkey** (`NOPERM`).
3. Given any non-admin ACL user, when it issues a destructive/admin command
   (`FLUSHALL`, `FLUSHDB`, `CONFIG`, `DEBUG`, `SHUTDOWN`, `SWAPDB`, `RESET`),
   then it is denied.
4. Given the `pm-gateway` and `pm-indexer` users, when they access keys, then
   each is confined to its namespaces — gateway: `asynq:*`, `pm:gateway:*`,
   `pm:device:*`, write `traefik/*`, read `pm:crl:*`; indexer: `asynq:*` and the
   search-index keyspace — and neither can read or write the other's `pm:*`
   namespace (verified by a `NOPERM` on a cross-namespace command).

### Valkey — mutual TLS

5. Given Valkey, when it is configured, then it listens on a **TLS port** with
   the **plaintext port disabled** (`port 0`, `tls-port` set) and
   `tls-auth-clients yes`; every service connects over TLS presenting a
   CA-signed client certificate and verifying the server cert against the CA. A
   plaintext connection, or a TLS connection without a valid client cert, is
   refused before AUTH.

### Postgres — mutual TLS + least privilege

6. Given `pg_hba` with `hostssl … cert clientcert=verify-full`, when a service
   connects (`sslmode=verify-full` client-side), then it must present a
   CA-signed client cert whose `CN` maps to its DB role; a plaintext, wrong-cert,
   or absent-cert connection is refused. Passwords are dropped (the cert is the
   credential).
7. Given the indexer database role, then it remains least-privilege
   (`pm_readonly`: `SELECT`-only), and control legitimately uses the owner role
   (migration runner + trust root) — documented, not changed. (Optional
   hardening, noted: scope the indexer's `SELECT` off secret/event tables;
   gated below by encryption-at-rest.)

### Provisioning

8. Given `deploy/setup.sh`, when it provisions, then it issues **CA-signed
   client certs** for control and indexer (gateways enroll per spec 31),
   generates a **distinct crypto-strong ACL secret per Valkey user**, and
   rejects missing/placeholder values at boot. mTLS is the **only** supported
   posture — there is no plaintext/single-password fallback (clean break,
   consistent with spec 31's removal of static gateway certs).

## Out of scope

- **Application-level task authenticity** — already covered by the spec-29
  task-HMAC. This spec hardens *access*, not *message integrity*.
- **Redesigning the Postgres role model.** The `pm_indexer`/`pm_readonly` split
  is already sound; control-as-owner is correct (migrations + trust root). No
  new runtime/DDL role split for control.
- **Valkey ACL isolation of Asynq bookkeeping.** Asynq's `asynq:*` keys
  (`asynq:queues`, `asynq:servers:*`, schedulers, deadlines) are **shared** by
  design across the three task-queue participants; strict per-queue key
  isolation is not achievable there. The residual (a task-queue participant
  poking another queue's Asynq keys) is covered by the spec-29 task-HMAC
  (forgery-proof) — stated as a scope limit, not silently assumed away.
- **Secrets-manager integration** (Vault/KMS-sourced credentials) — a later
  option; this spec keeps env/file-sourced secrets, hardened.
- **Rotating the datastore credentials automatically** — operator action
  (re-provision + rolling restart); no auto-rotation built.

## Technical design

### Affected repos (cross-repo order: server config/deploy → small Go seam)

This spec is **mostly deploy configuration** plus a small, env-gated Go seam. No
proto, no event types, no handlers.

**server — Go seam (`internal` / `cmd`):**
- The three Valkey client sites — [cmd/control/valkey.go:149](../../../server/cmd/control/valkey.go),
  [cmd/gateway/main.go:263](../../../server/cmd/gateway/main.go),
  [:614](../../../server/cmd/gateway/main.go), and
  [internal/taskqueue/client.go:63](../../../server/internal/taskqueue/client.go)
  — gain `Username` and a **required** `TLSConfig` on `redis.Options`, from env:
  - `*_VALKEY_USERNAME` (ACL user) + `*_VALKEY_PASSWORD` (ACL selection secret).
  - `*_VALKEY_CA` (server-cert trust root) + `*_VALKEY_TLS_CERT` /
    `*_VALKEY_TLS_KEY` → `TLSConfig.Certificates` (client cert, mandatory).
  - Boot **fails closed** if the cert env is absent — there is no plaintext
    fallback. Build the `*tls.Config` via the existing `internal/mtls` helpers
    (`NewTLSConfig`) so cert plumbing matches the rest of the system;
    `MinVersion: tls.VersionTLS13`.
- Postgres: the DSN carries `sslmode=verify-full&sslrootcert=…&sslcert=…&sslkey=…`
  (was `sslmode=disable`). Verify the pool builder (pgx) passes these through; no
  code change expected beyond the DSN.
- `cmd/control/doctor.go` — extend the Valkey/Postgres probes to report the
  auth/TLS posture (which user, TLS on/off) so `control doctor` surfaces a
  misconfiguration.

**server — deploy (`deploy/`):**
- `valkey.conf.template` — replace `requirepass __VALKEY_PASSWORD__` with a
  `user default off` line + per-service `user pm-control on >… ~… +@…` ACL
  lines; add `port 0`, `tls-port 6379`, `tls-cert-file`/`tls-key-file`/
  `tls-ca-cert-file`, and `tls-auth-clients yes`.
- `initdb.d/` — `pg_hba.conf` (or `POSTGRES_HOST_AUTH_METHOD` + a mounted
  `pg_hba`) using `hostssl … cert clientcert=verify-full`; server `ssl=on` with
  a mounted server cert. The existing `01-indexer-user.sh` role model is
  unchanged (CN → role).
- `compose.yml` — split `VALKEY_PASSWORD` into `VALKEY_{CONTROL,GATEWAY,INDEXER,
  TRAEFIK}_PASSWORD`; pass each service its own user+password; Traefik gets
  `--providers.redis.username=pm-traefik` + its read-only password + TLS
  endpoint config; mount the datastore server certs and each component's
  spec-31 CA-signed client cert.
- `setup.sh` — issue CA-signed client certs for control and indexer; generate
  the four Valkey ACL passwords (`openssl rand -base64 32` each); render
  `valkey.conf` with the ACL block; validate none are placeholders.

**docs:**
- Extend [04-security/08-deployment-hardening.md](../04-security/08-deployment-hardening.md)
  with the datastore-auth posture (per-service ACLs, TLS, the Traefik read-only
  user) — it already covers the Traefik/Docker-socket half of the same threat.

### Valkey ACL design (concrete)

| User | Keys | Commands | Rationale |
|---|---|---|---|
| `pm-control` | `~asynq:*` `~pm:*` `~traefik/*`* + search FT | `+@all` **minus** `-@dangerous` (`FLUSHALL`/`CONFIG`/`DEBUG`/`SHUTDOWN`) | Orchestrator: enqueues to all queues, reads+writes CRL, runs search queries |
| `pm-gateway` | `~asynq:*` `~pm:gateway:*` `~pm:device:*` `~traefik/*` `~pm:crl:revoked` | `+@read +@write +@stream` scoped; `-@dangerous` | Asynq consumer/producer, writes own routes + registry, reads CRL |
| `pm-indexer` | `~asynq:*` + search-index keyspace | search/FT + Asynq consume; `-@dangerous` | Search queue consumer + FT index owner; no `pm:*`/`traefik` |
| `pm-traefik` | **`~traefik/*` read-only** | `+get +mget +scan +type +ttl +ping +subscribe +psubscribe` only | Route discovery only; internet-facing + Docker-socket-exposed → smallest surface |

\* control does not *write* `traefik/*` (gateways do); include read-only if it
needs route introspection, else omit.

**Residual (stated, not hidden):** all three task-queue users share `asynq:*`
bookkeeping — inherent to Asynq. The task-HMAC (spec 29) is the compensating
control for cross-queue tampering; the ACL's job is to isolate the `pm:*` /
`traefik/*` namespaces and deny destructive commands.

### New dependencies

None. TLS via stdlib `crypto/tls` + existing `internal/mtls`; ACLs and TLS are
native Valkey/Postgres features. The client-cert mTLS reuses the spec-31 CA.

## Security considerations

- **Least privilege / lateral movement.** Per-service ACL users mean a
  single-component compromise is confined to that component's namespaces; the
  Traefik read-only user is the headline reduction (internet-facing + the
  Docker-socket exposure). Destructive commands (`FLUSHALL`/`CONFIG`) are denied
  to everyone.
- **Mutual TLS = transit encryption + client identity.** mTLS on both datastores
  closes the cleartext exposure that appears the moment components span hosts
  (the HA topology) AND binds every connection to a CA-signed identity — the same
  trust root as agent/gateway mTLS — so a stolen password alone is useless
  (Postgres has no password at all; Valkey's ACL secret is worthless without the
  client cert).
- **Encryption-at-rest bounds the indexer's broad SELECT.** `pm_readonly` can
  `SELECT` secret-bearing tables (IdP secrets, LUKS keys), but those columns are
  AES-GCM encrypted at rest (WS10) and the indexer holds no encryption key — so
  the broad grant leaks only ciphertext. Scoping the grant off those tables is
  *optional* defense-in-depth, noted in AC 7.
- **Secret hygiene.** No datastore credential or key is logged; `doctor` reports
  posture (user, TLS on/off), never secrets. setup.sh keeps secrets out of
  process cmdlines (the existing `valkey.conf`/`REDISCLI_AUTH` pattern).
- **Fail-closed provisioning.** Boot rejects missing/placeholder credentials
  (existing `CHANGE_ME` guard extended to the per-service secrets).

## Test requirements

Testing datastore auth needs a **real Valkey and real Postgres**
(testcontainers) — `miniredis` supports neither ACLs nor TLS.

- **Valkey ACL denial (real Valkey):** the `pm-traefik` user is refused a write
  and any non-`traefik/*` read (`NOPERM`); `pm-gateway` is refused a
  search-index / cross-namespace command; every non-admin user is refused
  `FLUSHALL`/`CONFIG`. A positive path: each user *can* do its own namespace's
  operations.
- **Valkey mTLS (real Valkey):** a plaintext client is refused when `port 0` +
  `tls-port` is set; a TLS client with no client cert is refused under
  `tls-auth-clients yes`; a client presenting a valid CA-signed cert + ACL
  user/password connects.
- **Postgres mTLS (testcontainer):** a `sslmode=disable` connection is refused
  when `pg_hba` is `hostssl`; a wrong/absent client cert is refused under
  `cert clientcert=verify-full`; a valid CN-mapped client cert connects.
- **Go seam:** the `redis.Options` carry `Username` + a non-nil `TLSConfig` with
  a client cert; boot **fails closed** when the cert env is absent (no plaintext
  fallback).
- **doctor:** reports the correct auth/TLS posture (ACL user, mTLS on, cert CN).

## Rejection paths

| Scenario | Result | Surfaced where |
|---|---|---|
| Traefik user issues a write / non-`traefik` read | `NOPERM` (denied) | Valkey; Traefik logs a provider error |
| Any user issues `FLUSHALL`/`CONFIG` | `NOPERM` | Valkey |
| Plaintext client to a TLS-only Valkey | connection refused | client dial error, fail to boot |
| `sslmode=disable` to a `hostssl` Postgres | `FATAL: no pg_hba.conf entry … SSL off` | connection error, fail to boot |
| Missing/placeholder ACL secret or client cert | boot aborts | `setup.sh` / component boot validation |
| Missing/invalid client cert | TLS handshake failure | connection refused |

## Rollout and migration

- **Hard dependency on spec 31.** This spec cannot land until spec 31's CA is
  issuing per-component client certs (gateways enroll; control/indexer certs from
  `setup.sh`). It is not phased and has no plaintext fallback — mTLS is the only
  posture (clean break, matching spec 31).
- **Breaking, coordinated deploy change** (ACL users + client certs must exist
  before services reconnect). Sequence: issue component client certs from the CA
  → render `valkey.conf` with ACL users + `tls-auth-clients yes` → set
  `pg_hba` to `hostssl … cert` → roll every service with its
  user/password/CA/client-cert env. Existing deploys must re-run `setup.sh` to
  provision certs before upgrading; a service without its client cert will not
  boot.
- **No data migration** — keyspace and schema are unchanged; only auth/transport
  config changes.
- Depends on: [spec 31](31-gateway-enrollment-and-control-ha.md) (CA-issued
  client certs) — a hard prerequisite, not an optional tier.

## References

- [spec 31](31-gateway-enrollment-and-control-ha.md) — CA-issued per-component
  identity reused for datastore mTLS.
- spec 29 (task-HMAC) — the compensating control this spec's access-hardening
  complements; [deployment hardening](../04-security/08-deployment-hardening.md)
  (Traefik/Docker-socket) — same threat, other half.
- WS10 (secrets at rest — AES-GCM), the existing `pm_indexer`/`pm_readonly`
  role model ([initdb.d/01-indexer-user.sh](../../../server/deploy/initdb.d/01-indexer-user.sh),
  [008_seeds.sql](../../../server/internal/store/migrations/008_seeds.sql)).
- New ADR to write on approval: **ADR datastore auth** (per-service ACL model,
  the shared-Asynq-keyspace residual, the mTLS + ACL/role model).
