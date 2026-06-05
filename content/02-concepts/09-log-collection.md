---
title: Log collection
---
# Log collection

Operators can query a device's logs on demand from the web UI. The agent runs `journalctl` locally with the requested filter and ships the output back over the mTLS stream. The control server stores the result keyed by a query ID; the UI polls until it arrives.

**On-demand pull, not push.** The agent does *not* tail logs continuously or ship them to a central store. If a device is offline when a query is dispatched, the query sits queued and runs when it reconnects.

## What's supported today

- **Backend:** `journalctl` only. Devices without journald (Alpine running OpenRC + syslog, etc.) can't currently answer log queries. A `LogSource` enum is reserved in the proto for syslog and file-based sources; wiring them is on the post-2026.06 backlog.
- **Filters:** unit name, time range (`since` / `until`), priority floor, free-form `grep` pattern, "kernel messages only" flag, and a line cap.
- **Output cap:** the agent truncates results at 1 MB and notes the truncation in the response. There is no second page — refine the filter if you hit the cap.

## How a query flows

1. Operator submits a query from the device-detail page → control server's `QueryDeviceLogs` RPC validates inputs and enqueues an Asynq task with a generated `query_id`.
2. The gateway dequeues and sends a `LogQuery` message over the agent's stream.
3. The agent runs `journalctl` with the validated args, captures stdout, truncates if needed, and returns a `LogQueryResult` carrying `(query_id, success, error, logs)`.
4. The gateway proxies the result back to control via `InternalService`; control stores it keyed by `query_id`.
5. The web UI polls `GetDeviceLogResult(query_id)` until the result lands.

## Safety guards

- **grep is ReDoS-validated.** The agent rejects patterns whose backtracking complexity exceeds a fixed budget before passing them to journalctl. Catches the obvious denial-of-self-service shapes.
- **No raw shell.** The agent constructs the journalctl argv programmatically — there is no `bash -c` interpolation of operator input.
- **No unbounded output.** The 1 MB truncation is enforced at the agent, not just the server, so a misbehaving device can't blow up the control server's memory by returning a 10 GB result.

## When to use

- Triage: "what did sshd say on this device in the last hour?"
- Incident response: "show me the kernel messages around the time the disk filled up."
- Compliance fishing: "did anyone log in as root yesterday?" (probably better answered by an [osquery](/concepts/osquery) query against `last`, but log collection works too).

For long-term log retention or fleet-wide search, you want a syslog forwarder + SIEM. Log collection is for "I have a device and a question right now."
