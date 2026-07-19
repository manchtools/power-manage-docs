---
title: Deployment hardening
---
# Deployment hardening

These are operator-side hardening choices for the reference deployment. They are
**not enforced by the application** — Power Manage does not dictate your reverse
proxy or container topology — but the reference `compose.yml` ships a
convenient-but-not-maximally-hardened default, and this page documents the
trade-offs so you can tighten it for your environment.

## Traefik and the Docker socket

The reference deployment runs Traefik with the Docker provider
(`--providers.docker=true`), which requires access to the Docker daemon socket
to discover container routes. The compose file bind-mounts it read-only:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

**The `:ro` is largely cosmetic here.** Read-only stops writing the socket
*file*, but the socket *is* the Docker API — any process that can reach it can
call the full daemon: inspect every container (including environment variables
and mounted secrets) and, depending on the daemon's configuration, create or
start containers, which is a path to host takeover. Traefik is your
internet-facing ingress, so a Traefik RCE or CVE is a high-value target — and
today that foothold reaches the whole host.

Two ways to close this, in rough order of preference:

### Option 1 — drop the Docker provider (best, no new dependency)

The gateways already register their routes through the Redis KV provider
(`--providers.redis`), so the Docker provider only discovers the **control** and
**indexer** HTTP routes (via `traefik.*` labels). If you move those two routes to
Traefik's file/static provider, Traefik no longer needs the Docker socket **at
all** — remove the bind-mount and `--providers.docker=true`. This eliminates the
exposure with no added component.

### Option 2 — a Docker socket proxy (keeps label discovery)

If you want to keep Docker-label auto-discovery, put a socket proxy (e.g.
`ghcr.io/tecnativa/docker-socket-proxy`, pinned by image digest) in front of the
socket:

- it is the **only** container that bind-mounts `/var/run/docker.sock`;
- it exposes a **filtered, read-only** Docker API to Traefik over a dedicated
  internal network — enable only `CONTAINERS` and `EVENTS`, keep `POST=0`;
- it publishes **no host port** and shares an internal network only with Traefik;
- point Traefik's Docker provider at the proxy's internal address instead of the
  socket.

A compromised Traefik is then limited to the read-only container/event queries
its discovery needs — no daemon writes, no container creation, no host takeover.

This is pure **defense in depth**: it does not prevent a Traefik compromise, it
bounds the blast radius. Keep Traefik patched regardless — patching lowers the
likelihood, the proxy (or Option 1) lowers the damage.

## Datastore access: per-service ACLs + mutual TLS

Since [spec 32](../06-specs/32-datastore-auth-hardening.md) the reference
deployment ships **least-privilege, mTLS-only** datastore access out of the
box (server ADR 0034). What an operator should know:

- **Every datastore connection is mutual TLS.** Valkey listens TLS-only
  (`port 0`, `tls-auth-clients yes`); Postgres accepts only
  `hostssl … cert clientcert=verify-full`, mapping the client-cert CN to the
  DB role — there are no Postgres passwords anymore. Client certs are issued
  from the deployment CA by `setup.sh`; a service without its cert fails
  closed at boot. There is no plaintext fallback to misconfigure back in.
- **Valkey is split into per-service ACL users** — `pm-control`, `pm-gateway`
  (CRL **read-only**, so a compromised gateway cannot un-revoke
  certificates), `pm-indexer` (queue + search namespaces only), and
  `pm-traefik` (**read-only `traefik/*`** — the internet-facing component
  holds the smallest credential). Destructive commands (`FLUSHALL`,
  `CONFIG`, …) are denied to all of them. The complement to the
  Docker-socket hardening above: even with a Traefik foothold, its Valkey
  credential yields read-only route discovery, not the CRL or the queues.
- **`NOPERM` in a service log means an ACL boundary fired.** If it is a
  legitimate new key namespace, widen *that user's* grant in
  `valkey.conf.template` narrowly — never back to `~*`. The deployment smoke
  test asserts the boundaries, so an accidental widening fails the gate.
- **`control doctor` reports the live posture** (ACL user, mTLS on/off,
  client-cert CNs) and warns on any plaintext configuration; it withholds
  credentials when it cannot dial TLS, so running it against a misconfigured
  environment cannot leak an ACL secret.
- **Rotation is explicit, not automatic on re-run.** `setup.sh` deliberately
  preserves set values, so a plain re-run rotates nothing. To rotate an ACL
  secret: clear its `VALKEY_*_PASSWORD` line in `.env` (or set it to
  `CHANGE_ME`), re-run `setup.sh` (a fresh secret is minted and
  `valkey.conf` re-rendered), then restart Valkey and the affected service.
