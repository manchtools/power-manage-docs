# Architecture

Power Manage is split into four runtime components plus a Postgres + Valkey backing store.

```
       Web UI / CLI                  Agents
         (JWT)                       (mTLS)
            │                          │
            ▼                          ▼
    ┌────────────────┐          ┌────────────┐
    │ Control server │          │  Gateway   │
    │  (Connect-RPC) │◄────────►│  (mTLS bidi│
    │   :8081 / TLS  │  proxy   │   stream)  │
    └────────┬───────┘  mTLS    └─────┬──────┘
             │                        │
             ▼                        ▼
       ┌──────────┐              ┌─────────┐
       │ Postgres │◄─── Asynq ───┤ Valkey  │
       │  (events │              │ (task   │
       │   store) │              │  queue) │
       └────┬─────┘              └─────────┘
            │
            ▼
       ┌──────────┐
       │  Indexer │
       │ (search) │
       └──────────┘
```

## Control server

The control server is the only component that talks to Postgres. It hosts:

- The Connect-RPC `ControlService` (web UI / CLI) over HTTPS + JWT
- The OIDC callback for SSO sign-in
- The SCIM v2 endpoint for IdP user/group provisioning
- The internal mTLS-protected `InternalService` that the gateway calls for credential-bearing operations

State changes are appended to an event store. Reads come from projection tables maintained by Go listeners that fire post-commit.

## Gateway

The gateway terminates mTLS from agents and runs the bidirectional Connect-RPC stream. It has **no database** — it doesn't even hold credentials. Action dispatches arrive via Asynq tasks the control server enqueues; agent-reported execution events flow back to the control inbox over a separate Asynq queue. Every Asynq envelope is HMAC-signed so a Valkey compromise can't forge tasks.

## Agent

The agent runs on managed Linux endpoints. It:

- Enrols once via a local Unix socket and a registration token
- Receives a CA-signed client certificate and renews at 80% of cert lifetime
- Streams heartbeats + execution results back to the gateway
- Executes seventeen action types idempotently
- Keeps running scheduled work when disconnected (offline scheduler)

Each dispatched action carries a CA-signature over `(actionID, type, paramsJSON)` that the agent verifies before executing — a tampered or forged dispatch is rejected outright.

## Indexer

The indexer is a tiny, stateless service that consumes search-index task events from Valkey and writes Valkey RediSearch indexes. It's logically part of the search subsystem rather than the control surface; you can run zero, one, or many instances depending on load.

## Why event sourcing?

Every state change is an immutable event. Projections are derived state — they can be rebuilt from the event log at any time. This buys us:

- **Audit trail by construction**: the `events` table *is* the audit log
- **Time-travel debugging**: any past state can be reconstructed
- **Schema evolution**: adding a new field is a new event, not a destructive migration
- **Tamper-evidence**: events have an actor + sequence number; a missing event leaves a hole

See [Event sourcing](/concepts/event-sourcing) for the projector pattern and how to write a new one.
