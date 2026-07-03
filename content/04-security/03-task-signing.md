---
title: Asynq task signing
---
# Asynq task signing

<!-- docref: begin src=server:internal/taskqueue/sign.go#Signer.Wrap:2248192e,server:internal/taskqueue/sign.go#Signer.Verify:04c49af7 -->
Every task that crosses the Asynq queue (Valkey-backed) carries an HMAC over its payload. The producer signs before enqueuing; the consumer strips the prefix, recomputes over the remainder, and constant-time-compares before handling. A compromised Valkey can't forge dispatches to agents or feed bogus execution events back to the control inbox.
<!-- docref: end -->

This is the first of two defences on dispatched work. The HMAC catches Valkey tampering. The full-envelope CA signature on each dispatch ([mTLS and signed actions](/security/mtls)) catches gateway tampering. Either one alone would leave a gap; together they cover the whole path control → Valkey → gateway → agent.

## Envelope format

```
[ 32 bytes: HMAC-SHA256(PM_TASK_SIGNING_KEY, payload) ][ payload bytes ]
```

```go docref=server:internal/taskqueue/sign.go#Signer.Wrap:2248192e
func (s *Signer) Wrap(payload []byte) []byte {
	if s == nil {
		return payload
	}
	mac := hmac.New(sha256.New, s.key)
	mac.Write(payload)
	sig := mac.Sum(nil)
	out := make([]byte, 0, len(sig)+len(payload))
	out = append(out, sig...)
	out = append(out, payload...)
	return out
}
```

<!-- docref: begin src=server:internal/taskqueue/sign.go#NewSigner:692dea19 -->
`PM_TASK_SIGNING_KEY` is a 32-byte symmetric key (64 hex chars — any other length is rejected at boot) shared between the control server, the gateway, and the indexer. It's set in `.env` once at deploy time.
<!-- docref: end -->

<!-- docref: begin src=server:internal/taskqueue/client.go#Client.EnqueueToDevice:1f8e84c8,server:internal/taskqueue/client.go#Client.EnqueueToControl:0a6412c5,server:internal/taskqueue/client.go#Client.EnqueueToSearch:f104c187 -->
The producer side is the taskqueue client's three enqueue paths — `EnqueueToDevice`, `EnqueueToControl`, and `EnqueueToSearch` — each of which wraps the JSON payload with the HMAC prefix before it lands in Valkey.
<!-- docref: end -->

<!-- docref: begin src=server:internal/gateway/task_handlers.go#TaskHandlerFactory.NewMux:16af41c9,server:internal/control/inbox_worker.go#InboxWorker.NewMux:d6337d7c,server:internal/search/worker.go#Worker.RegisterHandlers:64512f99 -->
The consumer side is `Signer.VerifyMiddleware()` wired into each `asynq.ServeMux`: the gateway's per-device task handlers, the control inbox worker, and the search (indexer) worker. Both sides live in `internal/taskqueue/` so the algorithm only has one implementation.
<!-- docref: end -->

## What gets signed

Both queue directions:

<!-- docref: begin src=server:internal/taskqueue/types.go#ControlInboxQueue:0ef91294,server:internal/taskqueue/types.go#DeviceQueue:83c7238e,server:internal/taskqueue/types.go#SearchQueue:d79beafc -->
| Producer | Consumer | What's on the queue |
|---|---|---|
| Control | Gateway (per-device queues) | Action dispatches, osquery / log-query dispatches, inventory requests, LUKS key revocations |
| Agent (via Gateway) | Control inbox (`control:inbox`) | Hello / heartbeats, execution results and output chunks, osquery / log-query results, inventory updates, security alerts; terminal audit chunks ride a dedicated serial queue |
| Control | Indexer (`search` queue) | Search index reconciliation tasks |
<!-- docref: end -->

A task that ends up on a Valkey queue without a valid HMAC is something the application code never produced. Either the key is wrong, or somebody is poking at Valkey directly.

## What happens on mismatch

<!-- docref: begin src=server:internal/taskqueue/sign.go#Signer.VerifyMiddleware:8511fb71,server:internal/taskqueue/sign.go#ErrSignatureMismatch:9212901e,server:internal/taskqueue/sign.go#ErrUnsignedTask:a5ca8c86 -->
The consumer middleware returns `asynq.SkipRetry`. Asynq treats that as "this task is poison, don't reschedule" and the envelope lands in the dead (archived) queue immediately rather than burning through the retry budget — an attacker with transient Valkey access can't burn retry slots by injecting unsigned tasks. The error names the queue and task type plus one of two distinguishable causes: `task signature mismatch` (key mismatch between producer and consumer, or queue tampering) versus `task is unsigned or truncated` (a producer that didn't wrap the payload, e.g. mid-upgrade).
<!-- docref: end -->

A pattern of signature-mismatch errors on one side means that side's key is wrong (or has drifted out of sync with the others). A burst across all three usually means an in-flight rotation hasn't finished.

Dead-lettered envelopes sit in Valkey under Asynq's archived keys (`asynq:{<queue>}:archived`). `docker compose exec valkey valkey-cli` plus the Asynq CLI inspector (`asynq dash` if you install it on the host) are the diagnostic surfaces today. A web UI view for the dead queue is not implemented.

## Key rotation

Today there's one supported mode: drain-and-cut. Pause new work, wait for all Asynq queues to drain, update `PM_TASK_SIGNING_KEY` in `.env` for all three services (control, gateway, indexer), restart the containers. Total outage is whatever your slowest queue takes to clear (usually under a minute).

<!-- docref: begin src=server:internal/taskqueue/sign.go:60bf637c -->
A zero-downtime overlap mode (verifier accepting two keys at once, producer signing with one) is **deliberately not** implemented — the signer code carries an explicit comment that says so. The reason is simple: an "accept either" verifier widens the trust window for the duration of the rotation, and the queues drain fast enough that drain-and-cut is the correct trade-off. Don't expect this to change unless the queue-drain time grows past "minutes" for someone.
<!-- docref: end -->

## When to rotate

- Suspected disclosure of `.env` (operator leaves, host compromise, accidental git push).
- Compliance-driven scheduled rotation (annual is a typical interval).
- After a Valkey instance is replaced with one whose authentication you can't audit.

You don't rotate after a routine config change, an unrelated incident, or "just in case". The key is symmetric and shared; rotation is operationally non-trivial. Treat it the way you'd treat rotating a database password: meaningful, deliberate, infrequent.

## What this doesn't protect

The HMAC protects the queue path. It does **not** authenticate the operator who created the original dispatch. That's the JWT on the Connect-RPC call to the control server. It does not authenticate the agent that produced an execution event. That's the agent's mTLS certificate on its stream into the gateway. The HMAC is one link in the chain; see [Threat model](/security/threat-model) for the others.
