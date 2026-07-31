---
title: Log collection
---
# Log collection

Log collection is an on-demand device operation, not continuous log shipping.
The agent runs the supported local log query and returns a bounded result.

Control stores the request durably before dispatch. Offline devices receive it
after reconnect over the direct mTLS stream. The result is correlated by query
and delivery IDs and stored as ordinary state.

## Safety

- Validate filters and limits before dispatch and again on the agent.
- Build command arguments without shell interpolation.
- Bound output at the agent before it crosses the network.
- Never include classified secret values in results, logs, traces, errors, or
  audit payloads.

Use an external log pipeline or SIEM for continuous retention and fleet-wide
log search.
