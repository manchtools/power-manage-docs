---
title: SHELL
---
# SHELL

Runs a shell script on the device. The general-purpose action for when no specialised type fits. Add a detection script and SHELL becomes idempotent: the agent only runs the remediation script if the detection script reports drift.

For one-off commands that don't need idempotency, use [`SCRIPT_RUN`](/action-reference/system/script-run). Same parameters and the same executor path; what differs is that a `SCRIPT_RUN` carries no detection script, so it is not idempotent across time.

## Parameters

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#ShellParams:0ec72f48,server:internal/authoring/state.go#validateActionSafety:e4c2fa2c,agent:internal/executor/executor.go#maxScriptSize:e74b340a -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `script` | string | conditional | — | The remediation script body. Max 1 MiB. At least one of `script` or `detection_script` is required — server-side validation and the agent both reject a SHELL action with neither set. |
| `interpreter` | string | no | `/bin/sh` | Path to the interpreter to invoke. Max 255 chars. |
| `run_as_root` | bool | no | `false` | `true` escalates through the privilege backend (sudo / doas / direct root). `false` runs the script **once per active graphical desktop session, as that user** — with nobody signed in it's a success no-op that retries on the next reconciliation tick. |
| `working_directory` | string | no | agent's cwd | Absolute path to run in. Must start with `/`. |
| `environment` | map\<string,string\> | no | — | Environment variables for the run. Screened by the SDK's env-hijack blocklist — `PATH`, `LD_*`, `LANG`/`LC_*`, and similar are rejected. |
| `detection_script` | string | no\* | — | Idempotency check. Exit 0 means "compliant, skip the remediation". Max 1 MiB. \*Required when `is_compliance` is `true`. |
| `is_compliance` | bool | no | `false` | If true, run only the detection script and report status. Never run the remediation. |

Setting `is_compliance: true` without a non-empty `detection_script` is rejected at authoring time: a compliance action is detection-only, so one with nothing to detect is refused rather than saved.
<!-- docref: end -->

## How it decides what to run

<!-- docref: begin src=agent:internal/executor/executor.go#Executor.executeShellStreaming:a1d14e71 -->
`is_compliance` is checked first, ahead of everything below. When it is set, the agent runs only the detection step and the remediation is ignored even when present — that's the mode for read-only audit policies. If the detection script is empty, the agent refuses the action outright ("compliance action requires a non-empty detection script; refusing to run its execution script") instead of falling through to the ordinary path below.

Otherwise:

1. If `detection_script` is set, run it.
2. Exit 0 means compliant. Skip remediation, report `changed=false`.
3. Non-zero exit and no `script` set means non-compliant. Report it.
4. Non-zero exit with `script` set means run the remediation.
5. Re-run the detection script to verify the remediation worked — if it still exits non-zero, the action fails with "remediation did not resolve the issue".

If `detection_script` is unset, the remediation script runs every time and the action always reports `changed=true`.
<!-- docref: end -->

## Examples

Idempotent: ensure `/etc/motd` has a custom banner.

```yaml
type: SHELL
detection_script: |
  grep -q "Property of ACME" /etc/motd
script: |
  echo "Property of ACME. Authorised use only." | sudo tee /etc/motd > /dev/null
run_as_root: true
```

One-off: report disk usage on every dispatch.

```yaml
type: SCRIPT_RUN
script: df -h
```

Compliance-only check: report whether SELinux is enforcing.

```yaml
type: SHELL
detection_script: |
  test "$(getenforce 2>/dev/null)" = "Enforcing"
is_compliance: true
```

## Gotchas

<!-- docref: begin src=agent:internal/executor/executor.go#Executor.ExecuteWithStreaming:bafece8a -->
- The exit code of the *remediation* script doesn't gate idempotency — only the detection script does. But a non-zero exit from either script fails the action (`script exited with code <n>`). It doesn't auto-retry; the next [reconciliation tick](/concepts/reconciliation) handles that.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/executor.go#Executor.runShellScript:78290ce4,agent:internal/executor/executor.go#Executor.runShellScriptPerUser:c8cd91af -->
- `run_as_root: false` is not "run as the agent's user". It fans out to every active desktop session and runs as each signed-in user, prefixing output lines with `[user=<name>]`. One user's failure doesn't stop the rest; the first failure decides the action result.
- The script body is passed as an argument (`<interpreter> -c <script>`), not on stdin. `/bin/bash`, `/usr/bin/python3`, `/usr/bin/perl` all work as `interpreter` as long as they accept `-c`.
- The child environment is a curated baseline (`HOME`, `USER`) plus your validated `environment` entries — the agent's own environment does **not** leak through, and the SDK runner forces `LC_ALL=C` and a sanitized `PATH`.
<!-- docref: end -->
<!-- docref: begin src=server:internal/store/audit.go#AuditOperation:42ce04d3,server:internal/store/audit.go#AuditEffect:4a8afbb5,server:internal/agentsecrets/service.go#Service.StoreLpsPasswords:2823d761 -->
- Don't put secrets in `script` or `detection_script`. There is no redactor: the audit log is metadata-only — an operation row of code-derived constants plus effect rows naming the *fields* that changed, never their values — so it holds no script body to scrub, but the body itself is stored verbatim as the action's parameters and sent to the agent in cleartext over mTLS. For credentials, use `LPS` or `ENCRYPTION`, whose secret fields travel sealed and are re-encrypted at rest before control stores them.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/executor.go#Executor.executeShellStreaming:a1d14e71 -->
- The detection-verify-retry sequence runs detection twice if the remediation script ran. Budget for that.
<!-- docref: end -->
