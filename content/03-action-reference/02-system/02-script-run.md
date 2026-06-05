---
title: SCRIPT_RUN
---
# SCRIPT_RUN

Runs a one-off script with output capture. Same parameter set as [`SHELL`](/action-reference/system/shell), different semantics: `SCRIPT_RUN` is not idempotent. It runs every time it's dispatched and always reports `changed=true`.

Use `SCRIPT_RUN` for things you want captured in the audit log without writing a detection script first: diagnostics, ad-hoc reports, one-shot data collection.

For idempotent shell work, use [`SHELL`](/action-reference/system/shell) with a `detection_script`.

## Parameters

Same `ShellParams` proto as `SHELL` — see [the SHELL reference](/action-reference/system/shell) for the full list. Two differences in effect:

- **`script` is functionally required.** The agent runs the remediation script unconditionally; without it there's nothing to run. Server-side validation accepts SHELL with only a `detection_script`, but for SCRIPT_RUN that combination is meaningless (the web form blocks it).
- **`detection_script` and `is_compliance` are accepted but ignored.** They belong to SHELL's idempotency story; SCRIPT_RUN has no idempotency.

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

- Output goes to the execution event in the audit log, capped at the agent's per-execution output limit (1 MB by default). Anything over that is truncated, with a note.
- No idempotency means the script runs on every [reconciliation tick](/concepts/reconciliation) if you put it in an assignment without a schedule. Add a cron schedule or a maintenance window unless you want it firing every tick (default 30 minutes).
- For sensitive output (passwords, tokens), prefer `SHELL` with a detection script that doesn't echo the value. The audit redactor doesn't scrub script output.
