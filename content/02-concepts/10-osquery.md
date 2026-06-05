---
title: osquery
---
# osquery integration

The agent has an opt-in osquery integration. When `osqueryi` is installed on a device, two things change:

1. [Device inventory](/concepts/device-inventory) collection switches to osquery's richer tables — better hardware detail, plus package inventories.
2. Operators can run on-demand SQL queries against the device from the web UI.

If osquery isn't installed, the agent falls back to its baseline inventory collector and the on-demand SQL path is disabled. Power-manage never installs osquery itself — that's a `PACKAGE` action on your side.

## What gets detected

The agent looks for `osqueryi` on `PATH` and at the conventional locations: `/usr/bin/osqueryi`, `/usr/local/bin/osqueryi`, `/opt/osquery/bin/osqueryi`. First hit wins. Initialisation is lazy — the registry is created on the first query, not at agent start, so adding osquery later doesn't require an agent restart (only the next inventory refresh or on-demand query).

## On-demand queries

Operators with the right permission can dispatch arbitrary SQL through the web UI:

1. The control server's RPC validates the query string and enqueues an Asynq task.
2. The gateway forwards an `OSQuery` message over the agent's stream.
3. The agent's `OnOSQuery` handler runs the query via `osqueryi --json`, parses the result, and sends rows back.
4. Result is stored server-side and surfaced in the UI.

The query is treated as untrusted: the agent shells out to `osqueryi`, not the SQL engine of a long-running daemon. There is no in-agent osquery socket. Pros: smaller attack surface, no extra daemon. Cons: per-query startup cost — fine for triage, not for high-frequency probing.

## When to use which

- **Inventory** answers "what is on this device, mostly statically?" — packages, hardware, OS.
- **osquery on-demand** answers "what is happening on this device right now?" — running processes, open sockets, current logins, file integrity rows.
- **Log collection** answers "what did this device say recently?" — journald history.

osquery shines when you need a structured cross-table join (e.g. "processes listening on a port, joined with their installing package"). For "is the file present", a [`SHELL`](/action-reference/system/shell) detection script with `test -e` is lighter weight.

## Known limits

- Only `osqueryi` (the standalone interactive binary) is wired up. `osqueryd` and the OSquery extension SDK are not used.
- Long queries are subject to the agent's per-execution timeout; tune the query, not the timeout.
- No scheduled / continuous queries today — every query is operator-initiated. Recurring fleet-wide telemetry is post-2026.06 work.
