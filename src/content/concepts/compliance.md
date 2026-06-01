# Compliance policies

A **compliance policy is essentially a remediation-less action**: same detection logic the agent already runs for converged-state actions, just without the "make it true" half. The output is a status — `compliant`, `drifting`, or `violating` — not a state change. Compliance detects drift; actions fix it.

The two are different first-class concepts in the data model. An action lives in the action catalogue and gets dispatched via an assignment; a compliance policy lives in the policies catalogue with its own assignment surface. You don't "wrap an action as a policy" or vice versa. You pick the concept that matches the intent and use the matching primitive.

## Anatomy of a rule

A rule has two parts:

| Part | What it does | Example |
|---|---|---|
| Check | Assertion against device state | `package curl is installed` |
| Grace period | Time the device gets to come back into compliance before "violating" | `4h` |

Checks reuse the same idempotency logic as actions: the agent runs the action type's detector (`PACKAGE` checks the package DB, `FILE` checks the file's hash and mode, `USER` checks `/etc/passwd`, …) and reports `present` / `absent` back.

## Policy → group → assignment

Policies attach to device groups, just like actions. Inheritance is additive: a policy attached to a group applies to every device that group resolves to (including the dynamic-query members).

The lifecycle on a device:

1. The agent evaluates the policy on its reconciliation tick.
2. If the check passes, the rule is `compliant`. If it fails, it enters `drifting` for the duration of the grace period.
3. If still failing when the grace period ends, the rule transitions to `violating`.

The events table records each transition. You can answer "when did this device stop being compliant with rule X?" by querying the events for the device.

## Reporting

Each device's detail page has a **Compliance** tab that lists every rule reaching that device, its current status, and the time the rule has been in that status. The events table backs the historical view — you can prove compliance over a time window for an auditor without running ad-hoc reports.

Group-level and fleet-level rollups are on the roadmap but not in 2026.06 — today the device-detail view is the primary surface.

## Action vs. compliance policy — when to pick which

Use an **action assigned in `REQUIRED` mode** when the agent should make the assertion true. "Every production host has curl" maps to a `PACKAGE` action with `desired_state: PRESENT`, assigned to the production device group.

Use a **compliance policy** when you want drift visibility but no automatic remediation. "Every production host *should* have curl, and I want to know when one doesn't" maps to a policy with the same `PACKAGE` check. The right choice when the corrective action is risky (kernel pinning, encryption key rotation) and you'd rather a human approve the fix.

Using both together is fine: an action assigned in `REQUIRED` that converges, paired with a compliance policy that monitors. The action runs on every reconciliation tick. The policy reports if something locally undoes the action's work between ticks — a useful signal for "drift caused by manual operator action on the box".
