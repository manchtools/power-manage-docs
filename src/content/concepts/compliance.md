# Compliance policies

A compliance policy is a bundle of rules the agent evaluates against device state on every [reconciliation tick](/concepts/reconciliation). The output is status (compliant, drifting, or violating), not corrective action. Compliance detects drift. Assignments fix it.

The distinction is intentional. An assignment in `REQUIRED` mode flips state. A compliance policy reports on state. The same `PACKAGE` action can be either; you decide by wrapping it in an assignment or in a policy.

## Anatomy of a rule

A rule has three parts:

| Part | What it does | Example |
|---|---|---|
| Check | Assertion against device state | `package curl is installed` |
| Grace period | Time the device gets to come back into compliance before "violating" | `4h` |
| Severity | Reporting weight | `low`, `medium`, `high`, `critical` |

Checks reuse the same idempotency logic as actions: the agent runs the action type's detector (`PACKAGE` checks the package DB, `FILE` checks the file's hash and mode, `USER` checks `/etc/passwd`, ...) and reports `present` / `absent` back.

## Policy → group → assignment

Policies attach to device groups, just like assignments. Inheritance is additive: a policy on a parent group applies to every member of every child group.

The lifecycle on a device:

1. The agent evaluates the policy on its reconciliation tick.
2. If the check passes, the rule is `compliant`. If it fails, it enters `drifting` for the duration of the grace period.
3. If still failing when the grace period ends, the rule transitions to `violating`. This is what shows up in dashboards and triggers any alerting you've wired up downstream.

The events table records each transition. You can answer "when did this device stop being compliant with rule X?" by querying the events for the device.

## Reporting

The web UI rolls device-level compliance up to group and fleet level. A device's **Compliance** tab shows every rule that applies, its current status, and the time the rule has been in that status. Group views show pass/fail counts. Fleet views show the worst rule across the whole population.

Audit log entries surface every state transition, so you can prove compliance over a time window for an auditor without running ad-hoc reports.

## When to pick which

Use an **assignment** when the agent should make the assertion true. "Every production host has curl" maps to a `PACKAGE` assignment, `PRESENT`, mode `REQUIRED`.

Use a **policy** when you want drift visibility but no automatic remediation. "Every production host should have curl" maps to a policy with the same check. The right choice when the corrective action is risky (kernel pinning, encryption key rotation) and you'd rather a human approve the fix.

Using both together is fine: an assignment that converges, paired with a policy that monitors. The assignment runs on every tick. The policy reports if something locally undoes the assignment's work.
