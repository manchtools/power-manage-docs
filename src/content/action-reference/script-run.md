# SCRIPT_RUN

Runs a one-off script with output capture. Same parameter set as [`SHELL`](/action-reference/shell), different semantics: `SCRIPT_RUN` is not idempotent. It runs every time it's dispatched and always reports `changed=true`.

Use `SCRIPT_RUN` for things you want captured in the audit log without writing a detection script first: diagnostics, ad-hoc reports, one-shot data collection.

For idempotent shell work, use [`SHELL`](/action-reference/shell) with a `detection_script`.

## Parameters

Identical to `SHELL`. See [the SHELL reference](/action-reference/shell) for the full list. The `detection_script` and `is_compliance` fields are accepted but ignored.

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
- No idempotency means the script runs on every [reconciliation tick](/concepts/reconciliation) if you put it in an assignment without a schedule. Add a cron schedule or a maintenance window unless you want it firing every 5 minutes.
- For sensitive output (passwords, tokens), prefer `SHELL` with a detection script that doesn't echo the value. The audit redactor doesn't scrub script output.
