---
title: Log collection
---
# Log collection

<!-- docref: begin src=agent:internal/handler/handler.go#Handler.OnLogQuery:5a637de3,sdk:sys/log/journald.go#journaldSource.Query:44fcc941 -->
Operators can query a device's logs on demand from the web UI. The agent runs `journalctl` locally with the requested filter and ships the output back over the mTLS stream. The control server stores the result keyed by a query ID; the UI polls until it arrives.
<!-- docref: end -->

**On-demand pull, not push.** The agent does *not* tail logs continuously or ship them to a central store. If a device is offline when a query is dispatched, the query sits queued and runs when it reconnects.

## What's supported today

<!-- docref: begin src=sdk:proto/pm/v1/agent.proto#LogSource:27537f88,sdk:proto/pm/v1/agent.proto#LogQuery:307a0198,agent:internal/handler/handler.go#Handler.OnLogQuery:5a637de3 -->
- **Backend:** `journalctl` only — the agent always queries journald. Devices without journald (Alpine running OpenRC + syslog, etc.) can't currently answer log queries. The proto's `LogSource` enum already defines a `LOG_SOURCE_SYSLOG` value (plain `/var/log` syslog files) and the SDK ships a syslog source, but the agent doesn't wire it up yet.
- **Filters:** unit name, time range (`since` / `until`), priority floor, free-form `grep` pattern, "kernel messages only" flag, and a line cap.
- **Output cap:** the agent truncates results at 1 MB, keeping the tail. There is no truncation marker and no second page — refine the filter if you hit the cap.
<!-- docref: end -->

## How a query flows

<!-- docref: begin src=sdk:proto/pm/v1/control.proto#ControlService.QueryDeviceLogs:21e826e5,sdk:proto/pm/v1/agent.proto#LogQueryResult:7ba0ad02,sdk:proto/pm/v1/control.proto#ControlService.GetDeviceLogResult:adb72716 -->
1. Operator submits a query from the device-detail page → control server's `QueryDeviceLogs` RPC validates inputs and enqueues an Asynq task with a generated `query_id`.
2. The gateway dequeues and sends a `LogQuery` message over the agent's stream.
3. The agent runs `journalctl` with the validated args, captures stdout, truncates if needed, and returns a `LogQueryResult` carrying `(query_id, success, error, logs)`.
4. The gateway proxies the result back to control via `InternalService`; control stores it keyed by `query_id`.
5. The web UI polls `GetDeviceLogResult(query_id)` until the result lands.
<!-- docref: end -->

## Safety guards

<!-- docref: begin src=sdk:sys/log/grepguard.go:8dc23e32,sdk:sys/log/journald.go#journaldSource.Query:44fcc941 -->
- **grep is ReDoS-guarded.** Before the pattern reaches journalctl, the SDK rejects regex shapes known to backtrack catastrophically — nested quantifiers, overlapping alternation under a quantifier, too many unbounded quantifiers — plus over-length patterns.
- **No raw shell.** The journalctl argv is constructed programmatically, every dynamic value the argument of a dedicated flag — there is no `bash -c` interpolation of operator input.
- **No unbounded output.** The 1 MB truncation is enforced at the agent, not just the server, so a misbehaving device can't blow up the control server's memory by returning a 10 GB result.
<!-- docref: end -->

## When to use

- Triage: "what did sshd say on this device in the last hour?"
- Incident response: "show me the kernel messages around the time the disk filled up."
- Compliance fishing: "did anyone log in as root yesterday?" (probably better answered by an [osquery](/concepts/osquery) query against `last`, but log collection works too).

For long-term log retention or fleet-wide search, you want a syslog forwarder + SIEM. Log collection is for "I have a device and a question right now."
