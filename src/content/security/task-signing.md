# Asynq task signing

`PM_TASK_SIGNING_KEY` is a 32-byte HMAC key shared between control, gateway, and indexer. Every Asynq task payload is wrapped as `[32 bytes HMAC-SHA256(key, payload)][payload bytes]`. The producer (`internal/taskqueue/Client.Enqueue*`) prepends the HMAC; the consumer (`asynq.ServeMux` middleware via `Signer.VerifyMiddleware()`) strips and verifies before dispatching to the handler.

A tampered or unsigned envelope returns `asynq.SkipRetry` — the task lands in the dead queue immediately rather than burning retries.

**TODO: expand with the key-rotation playbook and what an operator sees in logs when the key mismatches.**
