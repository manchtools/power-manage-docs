---
title: osquery
---
# osquery integration

The agent has an opt-in osquery integration. When `osqueryi` is installed on a device, two things change:

1. [Device inventory](/concepts/device-inventory) collection switches to osquery's richer tables — better hardware detail, plus package inventories.
2. Operators can run on-demand SQL queries against the device from the web UI.

If osquery isn't installed, the agent falls back to its baseline inventory collector and the on-demand SQL path is disabled. Power-manage never installs osquery itself — that's a `PACKAGE` action on your side.

## What gets detected

<!-- docref: begin src=sdk:sys/osquery/osquery.go#findOsqueryBinary:c778d547 -->
The agent looks for `osqueryi` at the conventional locations first — `/usr/bin/osqueryi`, `/usr/local/bin/osqueryi`, `/opt/osquery/bin/osqueryi` — then falls back to a `PATH` lookup. First hit wins.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/handler/handler.go#Handler.getOsquery:71bd6df0 -->
Initialisation is lazy — the registry is created on the first query, not at agent start, and a failed probe is re-checked on the next use, so adding osquery later doesn't require an agent restart (only the next inventory refresh or on-demand query).
<!-- docref: end -->

## On-demand queries

Operators with the right permission can dispatch arbitrary SQL through the web UI:

<!-- docref: begin src=sdk:proto/pm/v1/control.proto#ControlService.DispatchOSQuery:c83eb638,sdk:proto/pm/v1/agent.proto#OSQuery:4c31d1e8,agent:internal/handler/handler.go#Handler.OnQuery:f27b89ed,sdk:proto/pm/v1/control.proto#ControlService.GetOSQueryResult:afc3ee12 -->
1. The control server's `DispatchOSQuery` RPC validates the query string and enqueues an Asynq task.
2. The gateway forwards an `OSQuery` message over the agent's stream.
3. The agent's `OnQuery` handler verifies the request's CA signature, runs the query via `osqueryi --json`, parses the result, and sends rows back.
4. Result is stored server-side and surfaced via `GetOSQueryResult` in the UI.
<!-- docref: end -->

The query is treated as untrusted: the agent shells out to `osqueryi`, not the SQL engine of a long-running daemon. There is no in-agent osquery socket. Pros: smaller attack surface, no extra daemon. Cons: per-query startup cost — fine for triage, not for high-frequency probing.

## When to use which

- **Inventory** answers "what is on this device, mostly statically?" — packages, hardware, OS.
- **osquery on-demand** answers "what is happening on this device right now?" — running processes, open sockets, current logins, file integrity rows.
- **Log collection** answers "what did this device say recently?" — journald history.

osquery shines when you need a structured cross-table join (e.g. "processes listening on a port, joined with their installing package"). For "is the file present", a [`SHELL`](/action-reference/system/shell) detection script with `test -e` is lighter weight.

## Known limits

<!-- docref: begin src=sdk:sys/osquery/osquery.go#New:dda636e8,sdk:sys/osquery/osquery.go#defaultTimeout:7daeaf1a -->
- Only `osqueryi` (the standalone interactive binary) is wired up. `osqueryd` and the OSquery extension SDK are not used.
- Queries run under a 30-second default timeout in the SDK; tune the query, not the timeout.
- No scheduled / continuous queries today — every query is operator-initiated. Recurring fleet-wide telemetry is post-2026.06 work.
<!-- docref: end -->
