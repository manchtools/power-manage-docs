---
title: SCRIPT_RUN
---
# SCRIPT_RUN

Runs a one-off script with output capture. Same parameter set as [`SHELL`](/action-reference/system/shell), and the same executor path — what differs is intent: `SCRIPT_RUN` is what you dispatch when you want the output, not convergence, and it carries no detection script to make it idempotent across time.

Use `SCRIPT_RUN` for things you want captured against the execution record without writing a detection script first: diagnostics, ad-hoc reports, one-shot data collection.

For idempotent shell work, use [`SHELL`](/action-reference/system/shell) with a `detection_script`.

## Parameters

<!-- docref: begin src=agent:internal/executor/executor.go#Executor.ExecuteWithStreaming:1170ff78,agent:internal/executor/executor.go#Executor.executeShellStreaming:a1d14e71,server:internal/manifest/compiler.go#OneShotAction:84372c04,agent:internal/store/manifest.go#Store.BeginManifestRun:869363a8,agent:internal/store/manifest.go#Store.GetDueManifestDeliveries:6fd045a2 -->
Same `ShellParams` proto as `SHELL` — see [the SHELL reference](/action-reference/system/shell) for the full list. The agent runs both types through the exact same case of its executor, so `detection_script` and `is_compliance` behave identically (a passing detection still skips the script). What differs is how you use them:

- **`script` is what you want.** The web form expects one; a detection-only SCRIPT_RUN is technically accepted by the server but is just a compliance probe.
- **The action type does not control re-runs; the delivery kind does.** An explicit dispatch compiles a **one-shot** manifest, marked structurally on the manifest rather than inferred from the schedule. The agent runs it once, as soon as it records the delivery, and stamps the run in the same transaction that moves the cursor — after which the delivery is permanently excluded from the due-work query. A dispatched `SCRIPT_RUN` therefore runs exactly once and never comes back on a drift interval. The delivery row itself is kept, so a replayed delivery of the same ID stays absorbed instead of running a second time.
- **Recurrence comes from assignment, not dispatch.** Assign the action (or its ActionSet/Definition) if you want it to run on a cadence; the manifest then carries the authored schedule and the agent re-runs it accordingly.
<!-- docref: end -->

## Example

Capture disk usage and route it to the execution record:

```yaml
type: SCRIPT_RUN
script: |
  df -h
  echo "---"
  du -sh /var/log /var/cache | sort -h
```

## Gotchas

<!-- docref: begin src=sdk:sys/exec/types.go#MaxOutputBytes:380cb4fa,sdk:sys/exec/capped_buffer.go#truncationMarker:593e1237 -->
- Output goes to the execution record, capped at 1 MiB per stream (stdout and stderr separately). Anything over that is dropped and the output ends with `[output truncated]`.
<!-- docref: end -->
<!-- docref: begin src=agent:cmd/power-manage-agent/runtime.go#periodicSync:3db80acb,agent:cmd/power-manage-agent/runtime.go#syncStateFromControl:d8a54242,agent:internal/store/manifest.go#Store.RecordManifestDelivery:b40ecef4 -->
- Re-delivery is not re-execution. The periodic sync tick and an operator-triggered `SYNC` run the same delivery sync, and re-recording a delivery the agent already holds is a replay-safe no-op that leaves its schedule and execution state untouched. Repeat runs come from an *assigned* manifest's schedule, never from re-delivery and never from a one-shot dispatch.
<!-- docref: end -->
<!-- docref: begin src=server:internal/store/audit.go#AuditOperation:42ce04d3,server:internal/store/audit.go#AuditEffect:4a8afbb5 -->
- For sensitive output (passwords, tokens), prefer `SHELL` with a detection script that doesn't echo the value. Nothing scrubs script output: it is stored verbatim with the execution record, and there is no redactor behind it — the audit log is metadata-only, recording code-derived operation descriptors and the names of changed fields rather than any parameter or output value.
<!-- docref: end -->
