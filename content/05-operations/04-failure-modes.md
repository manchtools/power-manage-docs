---
title: Action failure modes
---
# Action failure modes

Not all actions fail the same way. A misconfigured `SHELL` action just exits non-zero and reports it; a bad `UPDATE` can leave a device unbootable. Knowing which class of failure each action can produce determines how safely you can "misconfigure to learn."

This page documents the failure mode of every action type when it's given inputs the executor accepts but the system rejects.

## The two safety classes

**Safe-to-misconfigure** — the action validates its own work before committing, fails cleanly, and leaves the device in the prior state. You can experiment against a production device without locking yourself out.

**Stateful-on-failure** — the action *can* leave the device in a worse state than it found it. Test in a staging device or scope it to a single canary before rolling out fleet-wide.

## Per-action reference

### Safe-to-misconfigure

<!-- docref: begin src=agent:internal/executor/helpers.go#Executor.writeAndValidateConfig:207cd164 -->
| Action | Pre-commit validation | What happens on bad input |
|---|---|---|
| `ADMIN_POLICY` | `visudo -c` on the rendered file before install | Action fails. The existing sudoers stays in place. No way to lock yourself out of sudo. |
| `SSHD` | `sshd -t` on the rendered drop-in fragment (written under `/etc/ssh/sshd_config.d/`, never `sshd_config` itself) before the reload | Invalid config never lands; a reload failure leaves `sshd` running on its last good config. New connections still work. |
<!-- docref: end -->
| `SHELL` (with `detection_script`) | Detection script gates the remediation | Detection failure is reported; remediation doesn't run. |
| `SERVICE` | `unit_content` SHA-checked; runtime state checked before start/stop | Bad unit content fails the systemd reload; the unit file is on disk but inactive. Action reports the failure. |
<!-- docref: begin src=agent:internal/executor/action_file.go#isProtectedPath:a21e4c09,sdk:pkg/repair.go#removeStaleLock:2acb4c8a -->
| `FILE`, `DIRECTORY` | Path-traversal + protected-prefix guards refuse writes/deletes on protected system paths | Refused at the agent; no write attempted. |
| `PACKAGE`, `DEB`, `RPM`, `APP_IMAGE`, `FLATPAK` | SHA-256 verified for URL-based installs; stale package-manager locks cleared (only when no live process holds them) before install | A genuinely broken package fails the install; the manager rolls back its transaction. |
<!-- docref: end -->
| `WIFI` | NetworkManager validates the profile | Bad profile fails to import; previous connections unaffected. |
| `USER` | `getent passwd` consulted before mutations | Bad input fails per-field; partial successes are possible (UID change might land while shell change fails) — read the execution event. |

### Stateful-on-failure

<!-- docref: begin src=agent:internal/executor/action_reboot.go:c7c35914 -->
| Action | What can go wrong | Mitigation |
|---|---|---|
| `REBOOT` | Schedules a reboot 5 minutes out (`shutdown -r +5` semantics). If the device boot is broken (kernel panic, root FS unmountable), nothing in power-manage can recover it. | Don't dispatch `REBOOT` against devices you can't physically reach until you've verified the last `UPDATE` action succeeded. |
<!-- docref: end -->
| `UPDATE` | Distro updates can break a device. Power-manage doesn't sandbox the package manager. | Pin to known-good package versions if your fleet is sensitive. Use maintenance windows + canary devices. |
| `LPS` | Rotates passwords for every account in `usernames`. A typo can rotate the wrong account's password. Service accounts whose password is in a config file *will* break. | Treat `usernames` as a hand-curated list. Test on one device first. See the [LPS warning block](/action-reference/identity-and-access/lps). |
<!-- docref: begin src=agent:internal/executor/luks.go:dd88f26f -->
| `ENCRYPTION` | Rotates LUKS passphrases. A bug here can lose access to the volume. Only the agent-managed passphrase slot is rewritten — other keyslots survive rotation. | Always keep at least one independent recovery key in a keyslot the agent doesn't manage. |
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/agent_update.go#Executor.executeAgentUpdate:6e49e8f9,agent:internal/executor/download.go#fetchArtifact:37286b7a -->
| `AGENT_UPDATE` | Self-test catches most regressions, but a passing self-test doesn't guarantee a healthy stream under load. | The downloaded binary is checksum-verified, then run in `self-test` mode under a 60-second ceiling before it replaces the live binary. If the self-test fails, the old binary keeps running. If it passes but the new binary degrades, set the action to `ABSENT` to stop further rollout and re-deploy the prior version. |
<!-- docref: end -->
| `SCRIPT_RUN` | Runs every dispatch. A script with side effects (DB writes, file deletes) runs unconditionally — there's no idempotency gate. | Wrap side-effecting work in `SHELL` with a detection script. Save `SCRIPT_RUN` for read-only diagnostics. |

## Reading the execution event

<!-- docref: begin src=server:internal/eventtypes/types.go#ExecutionCompleted:f3b5b093,server:internal/eventtypes/types.go#ExecutionFailed:f3b5b093,server:internal/eventtypes/types.go#ExecutionTimedOut:f3b5b093 -->
Every action emits one of three terminal events:

- `ExecutionCompleted` — the action ran to completion. `changed=true` means state was mutated; `changed=false` means it was already in the desired state.
- `ExecutionFailed` — the action errored. The event carries the error plus stdout/stderr from whatever sub-process or SDK call failed.
- `ExecutionTimedOut` — the action exceeded its per-action timeout. The agent killed the sub-process.
<!-- docref: end -->

For safe-to-misconfigure actions, `ExecutionFailed` is the *expected* failure path — the device is fine. For stateful-on-failure actions, `ExecutionFailed` may mean partial state changes landed; read the output carefully and consider rolling back manually.

## Rules of thumb

- **Validate locally first.** If you're authoring a `CUSTOM` `ADMIN_POLICY` or a complex `SHELL` script, run it on one device by hand before assigning it fleet-wide.
- **Use maintenance windows.** They limit blast radius — a bad `UPDATE` only breaks devices currently in their window, giving you time to react.
- **Canary, then rollout.** Assign new actions to one device group first; widen only after one full reconciliation cycle.
- **Prefer `desired_state: ABSENT` to "delete the action".** Deleting the action means dispatches stop, but state on existing devices stays. Switching to `ABSENT` converges the fleet back.
