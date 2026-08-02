---
title: Compliance
---
# Compliance policies

Compliance in power-manage is "did the device pass this assertion?", separated cleanly from "make the device pass this assertion." Assertions live as **compliance check actions**, a specific kind of `SHELL` action. Policies bundle one or more checks and attach to device groups via assignments.

<!-- docref: begin src=server:internal/compliance/handlers.go#Handlers.AddCompliancePolicyRule:d6eaf3e8,server:internal/compliance/state.go#validateComplianceAction:2a6ef4cb,server:internal/authoring/state.go#validateActionSafety:d9103ea9 -->
The split is enforced by the data model, and it is enforced twice. A compliance policy can only reference actions that are SHELL-type, carry `is_compliance: true`, **and** carry a non-empty `detection_script`. Authoring rejects a compliance action without a detection script when the action is created or updated, and `AddCompliancePolicyRule` rejects it again at attachment — a compliance rule that could never report a finding is refused rather than enrolled to evaluate nothing. Non-SHELL actions are refused outright; you can't promote a `PACKAGE` or `FILE` action into a compliance rule. That keeps the contract honest: compliance reports status, never side-effects state.
<!-- docref: end -->

## Anatomy

Two layers.

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#ShellParams.is_compliance:a2a51e26,sdk:proto/powermanage/v1/actions.proto#ShellParams.detection_script:74824474,agent:internal/executor/executor.go#Executor.executeShellStreaming:a1d14e71,server:internal/authoring/state.go#validateActionSafety:d9103ea9 -->
A **compliance check action** is a `SHELL` action with `is_compliance: true` **and** a `detection_script` that returns exit code `0` when the device is compliant and non-zero when it isn't. Both are mandatory: the server refuses to author a compliance action without a detection script, so the pair cannot come apart in normal use. The agent enforces the same rule independently. `is_compliance` is the *first* thing its executor checks, before any other branch: with a detection script it runs that script and stops there, so the action body / remediation script is never executed even if you fill it in; with an empty detection script it **fails closed** — the action errors out with "compliance action requires a non-empty detection script" rather than falling through and running the body.
<!-- docref: end -->

A **compliance policy** is a named bundle of references to those check actions. Each reference adds a grace period:

<!-- docref: begin src=sdk:proto/powermanage/v1/control.proto#AddCompliancePolicyRuleRequest:e5cb3d25,server:internal/compliance/handlers.go#Handlers.AddCompliancePolicyRule:d6eaf3e8 -->
| Part of a policy rule | What it means |
|---|---|
| `action_id` | Pointer to an existing SHELL action with `is_compliance: true` |
| `grace_period_hours` | How long a device gets to come back into compliance before the rule transitions from `IN_GRACE_PERIOD` to `NON_COMPLIANT` |
<!-- docref: end -->

The policy itself is just a container: name, description, and the rule list. Policies attach to device groups via the normal assignment flow, just like actions.

## Authoring flow

You write compliance in two stages because it lives in two artefacts:

1. **Create the check.** **Actions** → **New** → **SHELL**. Set `is_compliance: true`. Write a `detection_script` that exits 0 if compliant, non-zero otherwise — it is required, and saving the action without one is rejected. For example, "is curl installed":

   ```bash
   command -v curl
   ```

   No execution script needed; the executor's compliance branch never runs one anyway.

2. **Bundle into a policy.** **Compliance policies** → **New policy** → add the check action as a rule, pick a grace period.

3. **Assign the policy** to a device group. The Assign button on the policy's detail page targets device groups exactly the way action / action-set assignments do.

The agent evaluates the policy on its reconciliation cadence and reports the
result. Control stores current compliance state in ordinary tables and records
each transition as an audited effect.

## Lifecycle on a device

1. Agent evaluates the policy on its reconciliation tick.
2. Detection passes → rule is `COMPLIANT`. Detection fails → rule enters `IN_GRACE_PERIOD` for the duration of the grace period.
3. Still failing when the grace period ends → rule transitions to `NON_COMPLIANT`.

The audit log records each transition under the originating operation ID.

## Reporting

Each device's detail page has a **Compliance** tab listing every applicable
rule, its current status, and time in that status. Historical transition
evidence comes from the audit log; application state is never replayed from it.

## Compliance vs. action: when to pick which

Use an **action assigned in `REQUIRED` mode** when the agent should make the assertion true.

> "Every production host has curl" → a `PACKAGE` action with `desired_state: PRESENT`, assigned to the production device group.

Use a **compliance policy** when you want to know about drift but explicitly don't want the agent to fix it. Because compliance checks are their own scripts, the check doesn't have to mirror an existing action. It can assert anything you can write a shell script for.

> "Every production host should have curl, and I want to know when one doesn't, but installation is gated through change management, not the agent" → a SHELL action with `is_compliance: true` and the detection `command -v curl`, bundled into a policy assigned to the production group.

You can run both side by side: an action in `REQUIRED` that converges, plus a compliance policy with a check that asserts the same condition. The action runs every reconciliation tick. The policy reports between ticks if something locally undoes the action's work, which is a useful signal for "drift caused by manual operator action on the box."
