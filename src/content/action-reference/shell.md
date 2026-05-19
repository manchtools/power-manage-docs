# SHELL

Runs a shell script on the device. The general-purpose action for when no specialised type fits. Add a detection script and SHELL becomes idempotent: the agent only runs the remediation script if the detection script reports drift.

For one-off commands that don't need idempotency, use `SCRIPT_RUN`. Same parameters, different semantics. `SCRIPT_RUN` always runs and never reports `changed=false`.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `script` | string | no | — | The remediation script body. Max 1 MB. |
| `interpreter` | string | no | `/bin/sh` | Path to the interpreter to invoke. Max 255 chars. |
| `run_as_root` | bool | no | `false` | Execute under sudo / doas. |
| `working_directory` | string | no | `$HOME` | Absolute path to `cd` into before running. Must start with `/`. |
| `environment` | map\<string,string\> | no | — | Environment variables to set for the run. |
| `detection_script` | string | no | — | Optional idempotency check. Exit 0 means "compliant, skip the remediation". Max 1 MB. |
| `is_compliance` | bool | no | `false` | If true, run only the detection script and report status. Never run the remediation. |

## How it decides what to run

1. If `detection_script` is set, run it.
2. Exit 0 means compliant. Skip remediation, report `changed=false`.
3. Non-zero exit and no `script` set means non-compliant. Report it.
4. Non-zero exit with `script` set means run the remediation.
5. Re-run the detection script to verify the remediation worked.

If `detection_script` is unset, the remediation script runs every time and the action always reports `changed=true`.

`is_compliance=true` makes the agent run only the detection step. The remediation is ignored even when present. That's the mode for read-only audit policies.

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

- The exit code of the *remediation* script doesn't gate idempotency. Only the detection script does. A remediation that exits non-zero reports as a failure but doesn't auto-retry; the next reconciliation tick handles that.
- Secrets in `script` or `detection_script` get redacted from the audit log, but they're sent to the agent in cleartext over mTLS. For credentials at rest, use `LPS`, `ENCRYPTION`, or the IdP credential store instead.
- The detection-verify-retry sequence runs detection twice if the remediation script ran. Budget for that.
- `interpreter` is invoked literally. `/bin/bash`, `/usr/bin/env python3`, even `/usr/bin/perl` all work. The script body goes in on stdin.
