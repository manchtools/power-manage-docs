# Compliance policies

Compliance in power-manage is "did the device pass this assertion?", separated cleanly from "make the device pass this assertion." Assertions live as **compliance check actions** — a specific kind of `SHELL` action; policies bundle one or more checks and attach to device groups via assignments.

The split is enforced by the data model. A compliance policy can only reference actions that are SHELL-type **and** carry `is_compliance: true`. The server's `AddCompliancePolicyRule` RPC refuses anything else; you can't promote a `PACKAGE` or `FILE` action into a compliance rule. That keeps the contract honest: compliance reports status, never side-effects state.

## Anatomy

Two layers.

A **compliance check action** is a `SHELL` action with `is_compliance: true`. It has a `detection_script` that returns exit code `0` when the device is compliant and non-zero when it isn't. The action body / remediation script is ignored under `is_compliance` — even if you fill it in, the agent's executor never runs it (see [`executor.go`](https://github.com/manchtools/power-manage-agent/blob/main/internal/executor/executor.go) `executeShellStreaming`, compliance branch).

A **compliance policy** is a named bundle of references to those check actions. Each reference adds a grace period:

| Part of a policy rule | What it means |
|---|---|
| `action_id` | Pointer to an existing SHELL action with `is_compliance: true` |
| `grace_period_hours` | How long a device gets to come back into compliance before the rule transitions from `drifting` to `violating` |

The policy itself is just a container — name, description, and the rule list. Policies attach to device groups via the normal assignment flow, just like actions.

## Authoring flow

You write compliance in two stages because it lives in two artefacts:

1. **Create the check.** **Actions** → **New** → **SHELL**. Set `is_compliance: true`. Write a `detection_script` that exits 0 if compliant, non-zero otherwise. For example, "is curl installed":

   ```bash
   command -v curl
   ```

   No execution script needed; the executor's compliance branch never runs one anyway.

2. **Bundle into a policy.** **Compliance policies** → **New policy** → add the check action as a rule, pick a grace period.

3. **Assign the policy** to a device group. The Assign button on the policy's detail page targets device groups exactly the way action / action-set assignments do.

The agent now evaluates the policy every reconciliation tick: it runs the detection script and reports `compliant` / `not compliant` back. Status transitions are events; the audit log replays them per device.

## Lifecycle on a device

1. Agent evaluates the policy on its reconciliation tick.
2. Detection passes → rule is `compliant`. Detection fails → rule enters `drifting` for the duration of the grace period.
3. Still failing when the grace period ends → rule transitions to `violating`.

The events table records each transition. "When did this device stop being compliant with rule X?" is one query against the events for that device.

## Reporting

Each device's detail page has a **Compliance** tab listing every rule that reaches it, the current status, and the time the rule has been in that status. The events table backs the historical view — you can prove compliance over a time window for an auditor without running ad-hoc reports.

Group-level pass/fail rollups and a fleet-level worst-rule view are on the roadmap but not in 2026.06. Today the device-detail view is the primary surface; for group views, query the events table directly.

## Compliance vs. action — when to pick which

Use an **action assigned in `REQUIRED` mode** when the agent should make the assertion true.

> "Every production host has curl" → a `PACKAGE` action with `desired_state: PRESENT`, assigned to the production device group.

Use a **compliance policy** when you want to know about drift but explicitly don't want the agent to fix it. Because compliance checks are their own scripts, the check doesn't have to mirror an existing action — it can assert anything you can write a shell script for.

> "Every production host should have curl, and I want to know when one doesn't — but installation is gated through change management, not the agent" → a SHELL action with `is_compliance: true` and the detection `command -v curl`, bundled into a policy assigned to the production group.

You can run both side by side: an action in `REQUIRED` that converges, plus a compliance policy with a check that asserts the same condition. The action runs every reconciliation tick. The policy reports between ticks if something locally undoes the action's work — a useful signal for "drift caused by manual operator action on the box."
