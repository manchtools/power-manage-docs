# Architecture

Six runtime components: a Postgres event store, a Redis task queue and search index, three Go services (control, gateway, indexer), and Traefik in front of all of it. The web UI doesn't appear in the diagram as a process. It's a hosted SPA running in the operator's browser.

```mermaid
flowchart LR
    Web[Browser<br/>hosted SPA] -->|HTTPS + JWT| Control[Control server<br/>Connect-RPC]
    Control -->|sqlc, read+write| PG[(PostgreSQL<br/>events + projections)]
    Control -.->|enqueue| Redis[(Redis<br/>Asynq + RediSearch)]
    Redis -.->|dequeue| Gateway[Gateway<br/>no DB]
    Redis -.->|dequeue| Indexer[Indexer<br/>search]
    Indexer -->|sqlc, read-only<br/>reconcile| PG
    Gateway -.->|bidi stream / mTLS| Agent[Agent<br/>mTLS]
    Gateway -->|InternalService proxy| Control
    Indexer -->|FT.CREATE / FT.SEARCH| Redis
```

## Control server

The control server is the only thing that **writes** to Postgres. Every state change goes through its `AppendEvent` path. The indexer reads Postgres read-only as part of its drift-reconciliation loop (see below); the gateway and agent never touch Postgres at all.

It runs on `:8081` and hosts:

- The Connect-RPC `ControlService` over HTTPS plus JWT for the web UI and CLI (164 RPCs across users, devices, actions, assignments, groups, IdPs, SCIM, TOTP, compliance, audit, search)
- The OIDC callback for SSO sign-in
- The SCIM v2 endpoint at `/scim/v2/{slug}/` for IdP user and group provisioning
- The internal mTLS-protected `InternalService` on `:8082` that the gateway calls for credential-bearing operations (LUKS keys, LPS passwords, auto-update info)

State changes go into the event store. Reads come from projection tables that Go listeners keep current after each commit.

## Gateway

The gateway terminates agent mTLS, runs the bidirectional Connect-RPC stream on `:8080`, and exposes the remote-terminal WebSocket on `:8443`. No database. No credentials. Action dispatches arrive as Asynq tasks the control server enqueues; agent-reported execution events flow back through a separate Asynq inbox queue. Every Asynq envelope carries an HMAC so a compromised Redis can't forge tasks.

Multi-gateway topology is supported via Redis self-registration: each gateway publishes its hostname into a Redis set on boot, and Traefik routes by SNI. Traffic for an agent goes to whichever gateway holds its current stream.

## Indexer

The indexer is a stateless service that drains search-related events off Asynq and writes RediSearch indexes into Redis. It also runs a periodic reconciliation against Postgres (default every 1h, configurable) to repair drift if a write got lost. For that reconciliation pass it reads Postgres directly (read-only).

Always run at least one indexer instance. Listing pages in the web UI (devices, actions, action sets, users, audit events, …) are search-backed; without an indexer, search returns nothing and those lists go blank. Scale to several instances if your search QPS gets serious.

## Agent

The agent runs as root on managed Linux endpoints. It:

- Enrols once through a local Unix socket using a registration token. No sudo required to enrol.
- Receives a CA-signed client certificate (1-year validity) and renews at 80% of its lifetime
- Streams heartbeats and execution results to the gateway over Connect-RPC bidi
- Executes 24 action types idempotently
- Keeps running scheduled work while disconnected and reconciles when it reconnects
- Self-updates on receipt of an `AGENT_UPDATE` action, verifying the new binary's SHA-256 before swap

Each dispatch carries a CA-signature over `(actionID, type, paramsJSON)`. The agent verifies it before executing, so a tampered or forged dispatch is rejected.

## Web UI

The web UI is a SvelteKit SPA hosted separately from the server. Browsers fetch the SPA from the web host, then make all subsequent RPCs directly to the operator's control server. The web host serves static files plus a small proxy for OIDC callbacks and asset rewriting; it never sees fleet data, JWTs, or events. See [The web UI](/get-started/web-ui) for details.

## Why event sourcing?

Every state change is an immutable event. Projections are derived from the event log and can be rebuilt at any time.

That gets you a few things. The `events` table is the audit log, so there's no second source of truth to drift. Any past state is reconstructable for debugging. Adding a field is a new event, not a destructive migration. Every event carries an actor and a sequence number, so a missing entry is visible.

See [Event sourcing](/concepts/event-sourcing) for the projector pattern.
