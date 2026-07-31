---
title: osquery
---
# osquery integration

osquery is optional. If `osqueryi` is available, the agent can enrich
inventory with an allowlisted table set and run authorized on-demand queries.
If it is absent, the core agent and baseline inventory continue to work.

## On-demand flow

1. Control validates and stores the request as durable device work.
2. The dispatcher offers it over the direct agent mTLS stream.
3. The agent applies its own validation and timeout, invokes `osqueryi`
   without a shell, and returns bounded structured rows.
4. Control stores the result for the requesting operator.

Use inventory for routine device facts, osquery for structured point-in-time
questions, and log collection for journald history.
