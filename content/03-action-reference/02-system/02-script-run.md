---
title: SCRIPT_RUN
---
# SCRIPT_RUN

Runs a one-off script with output capture. Same parameter set as [`SHELL`](/action-reference/system/shell), different lifecycle: `SCRIPT_RUN` is not idempotent across time. It runs when dispatched and — unlike every other action type — is never stored in the agent's offline scheduler, so it won't re-run on the agent's schedule afterwards.

Use `SCRIPT_RUN` for things you want captured in the audit log without writing a detection script first: diagnostics, ad-hoc reports, one-shot data collection.

For idempotent shell work, use [`SHELL`](/action-reference/system/shell) with a `detection_script`.

## Parameters

<!-- docref: begin src=agent:internal/handler/handler.go#Handler.OnActionWithStreaming:2ce743bd,agent:internal/executor/executor.go#Executor.executeShellStreaming:be2fc8f6 -->
Same `ShellParams` proto as `SHELL` — see [the SHELL reference](/action-reference/system/shell) for the full list. The agent executes both types through the exact same shell path, so `detection_script` and `is_compliance` behave the same *within a single run* (a passing detection still skips the script). The differences are lifecycle:

- **`script` is what you want.** The web form expects one; a detection-only SCRIPT_RUN is technically accepted by the server but is just a one-shot compliance probe.
- **No scheduled re-runs.** SHELL actions are stored on the agent and re-run on their schedule; a SCRIPT_RUN executes once per dispatch and is forgotten.
<!-- docref: end -->

## Example

Capture disk usage and route it to the audit log:

```yaml
type: SCRIPT_RUN
script: |
  df -h
  echo "---"
  du -sh /var/log /var/cache | sort -h
```

## Gotchas

<!-- docref: begin src=sdk:sys/exec/types.go#MaxOutputBytes:380cb4fa,sdk:sys/exec/capped_buffer.go#truncationMarker:593e1237 -->
- Output goes to the execution event in the audit log, capped at 1 MiB per stream (stdout and stderr separately). Anything over that is dropped and the output ends with `[output truncated]`.
<!-- docref: end -->
<!-- docref: begin src=agent:cmd/power-manage-agent/runtime.go#periodicSync:2e2cbb96 -->
- "Runs once per dispatch" includes re-dispatches: a SCRIPT_RUN in an assignment runs again whenever the device does a *full* desired-state reconcile — a fresh agent connection or an operator-triggered `SYNC` — though not on the incremental periodic tick. Don't put anything destructive in one without making it safe to repeat.
<!-- docref: end -->
<!-- docref: begin src=server:internal/api/audit_handler.go#actionRedactionSchemas:c90a68f4 -->
- For sensitive output (passwords, tokens), prefer `SHELL` with a detection script that doesn't echo the value. The audit redactor scrubs the script *body*, not the script's output.
<!-- docref: end -->
