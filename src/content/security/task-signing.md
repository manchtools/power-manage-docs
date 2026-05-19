# Asynq task signing

Every task that crosses the Asynq queue (Valkey-backed) carries an HMAC over its payload. The producer signs before enqueuing; the consumer verifies before handling. A compromised Valkey can't forge dispatches to agents or feed bogus execution events back to the control inbox.

This is the first of two defences on dispatched work. The HMAC catches Valkey tampering. The per-action RSA signature on each dispatch ([mTLS and signed actions](/security/mtls)) catches gateway tampering. Either one alone would leave a gap; together they cover the whole path control → Valkey → gateway → agent.

## Envelope format

```
[ 32 bytes: HMAC-SHA256(PM_TASK_SIGNING_KEY, payload) ][ payload bytes ]
```

`PM_TASK_SIGNING_KEY` is a 32-byte symmetric key shared between the control server, the gateway, and the indexer. It's set in `.env` once at deploy time. Producers prepend the HMAC; consumers strip it, recompute over the remainder, and constant-time-compare against the prefix before handing the task to its handler.

The producer code is `internal/taskqueue/Client.Enqueue*`. The consumer middleware is `Signer.VerifyMiddleware()` wired into the `asynq.ServeMux` setup. Both sides live in `internal/taskqueue/` so the algorithm only has one implementation.

## What gets signed

Both queue directions:

| Producer | Consumer | What's on the queue |
|---|---|---|
| Control | Gateway | Action dispatches per device, terminal session starts, agent-update notifications |
| Agent (via Gateway) | Control inbox | Execution events, heartbeats, inventory updates, audit-relevant agent reports |
| Control | Indexer | Search index reconciliation tasks |

A task that ends up on a Valkey queue without a valid HMAC is something the application code never produced. Either the key is wrong, or somebody is poking at Valkey directly.

## What happens on mismatch

The consumer middleware returns `asynq.SkipRetry`. Asynq treats that as "this task is poison, don't reschedule" and the envelope lands in the dead queue immediately rather than burning through the retry budget.

In the logs (control, gateway, or indexer depending on which side rejected):

```
level=warn msg="task signature verification failed"
  task_type=action.dispatch
  task_id=ulid-...
  queue=device:dev_01J...
  reason=hmac_mismatch
```

A pattern of `hmac_mismatch` warnings on one side means that side's key is wrong (or has drifted out of sync with the others). A burst across all three usually means an in-flight rotation hasn't finished.

Dead-letter envelopes sit in Valkey under the `asynq:dead:*` keys. `docker compose exec valkey valkey-cli` plus the Asynq CLI inspector (`asynq dash` if you install it on the host) are the diagnostic surfaces today. A web UI view for the dead queue is not implemented.

## Key rotation

Today there's one supported mode: drain-and-cut. Pause new work, wait for all Asynq queues to drain, update `PM_TASK_SIGNING_KEY` in `.env` for all three services (control, gateway, indexer), restart the containers. Total outage is whatever your slowest queue takes to clear — usually under a minute.

A zero-downtime overlap mode (verifier accepting two keys at once, producer signing with one) is not yet implemented. It's tracked under the 2026.06 milestone alongside the rest of the secret rotation playbook.

## When to rotate

- Suspected disclosure of `.env` (operator leaves, host compromise, accidental git push).
- Compliance-driven scheduled rotation (annual is a typical interval).
- After a Valkey instance is replaced with one whose authentication you can't audit.

You don't rotate after a routine config change, an unrelated incident, or "just in case". The key is symmetric and shared; rotation is operationally non-trivial. Treat it the way you'd treat rotating a database password: meaningful, deliberate, infrequent.

## What this doesn't protect

The HMAC protects the queue path. It does **not** authenticate the operator who created the original dispatch. That's the JWT on the Connect-RPC call to the control server. It does not authenticate the agent that produced an execution event. That's the agent's mTLS certificate on its stream into the gateway. The HMAC is one link in the chain; see [Threat model](/security/threat-model) for the others.
