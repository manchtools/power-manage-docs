# Quick start

Once at least one agent is connected, the typical first workflow is:

1. Create an **action** — a unit of executable intent (a shell script, a package install, a file write, etc.).
2. Group actions into an **action set** if multiple actions belong together (e.g. "baseline hardening").
3. Optionally bundle action sets into a **definition** for higher-level grouping.
4. Create a **device group** — either static (you pick devices) or dynamic (a query like `device.labels.environment equals "production"`).
5. Create an **assignment** linking the action / set / definition to the device / user / group.

The agent receives signed dispatches over its mTLS stream, executes idempotently with desired-state semantics (`PRESENT` / `ABSENT`), and reports back an execution event that the audit log captures verbatim.

{% callout type="info" title="Idempotency by default" %}
Every action type that supports it (packages, files, users, services, sshd config, repositories, …) compares the current device state against the desired state before doing anything. Re-dispatching the same action against an already-converged device is a no-op.
{% /callout %}

## Example: ensure curl is installed on production

In the web UI:

1. **Actions** → New → `PACKAGE` type → name "Install curl", package name `curl`, desired state `PRESENT`.
2. **Device groups** → New dynamic group → query `labels.environment equals "production"`.
3. **Assignments** → New → action "Install curl" + group "production" + mode `enforce`.

The next time each production agent's reconciliation tick fires (default every 5 minutes, configurable per assignment), the action runs. Devices that already have curl skip; devices that don't, install it, and the execution event records the apt/dnf/pacman/zypper invocation output.

## Where to read next

- [Architecture](/concepts/architecture) for how events flow from RPC to projection
- [Action reference](/action-reference) for every action type's parameters
- [Security model](/security/threat-model) for the trust boundaries and what each one guarantees
