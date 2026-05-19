# Quick start

With one agent connected, here's the loop:

1. Create an **action**. An action is a single unit of work: install a package, write a file, run a script.
2. If several actions belong together (say, a "baseline hardening" bundle), put them in an **action set**.
3. If you want to group action sets further, wrap them in a **definition**.
4. Create a **device group**. Static groups are hand-picked. Dynamic groups use a query like `device.labels.environment equals "production"`.
5. Create an **assignment** that ties the action, set, or definition to a device, user, or group.

The agent picks up signed dispatches off its mTLS stream, applies them idempotently against the desired state (`PRESENT` or `ABSENT`), and reports back an execution event that ends up in the audit log verbatim.

{% callout type="info" title="Idempotent by default" %}
Anywhere it makes sense (packages, files, users, services, sshd config, repositories), the agent checks the current device state before doing anything. Re-running the same action against a converged device is a no-op.
{% /callout %}

## Example: ensure curl is installed on production

In the web UI:

1. **Actions** → New → type `PACKAGE`, name "Install curl", package `curl`, state `PRESENT`.
2. **Device groups** → New dynamic group → query `labels.environment equals "production"`.
3. **Assignments** → New → action "Install curl", group "production", mode `enforce`.

The next reconciliation tick (default 5 minutes, configurable per assignment) runs the action on each production agent. Devices that already have curl skip; the rest install it, and the execution event records the apt / dnf / pacman / zypper output.

## Where to go next

- [Architecture](/concepts/architecture) for how events flow from RPC to projection
- [Action reference](/action-reference) for every action type's parameters
- [Security model](/security/threat-model) for the trust boundaries and what each one guarantees
