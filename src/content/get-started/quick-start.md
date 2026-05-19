# Quick start

You have a control server up and one agent enrolled. Time to make something happen.

If you haven't gotten that far yet, [Installation](/get-started/installation) is the page you want. If the stack is up but no agent is talking to it, follow the enrolment block at the bottom of that page first.

{% callout type="info" title="Sign in via the hosted UI" %}
The server doesn't bundle a web UI. Sign in at **{{WEB_UI_URL}}** and point it at your control-server domain. Every RPC the UI makes goes straight from your browser to your server. See [The web UI](/get-started/web-ui) for the full trust model.
{% /callout %}

## The mental model

Five primitives, in order of how often you'll touch them.

**Actions** are single units of work. One action installs one package, writes one file, runs one script. Composability comes from the layer above.

**Action sets** are ordered groups of actions. "Baseline hardening" is a typical example: add a repo, install a package, drop a config file, enable a service. The agent runs the actions in order and aborts the set on the first failure (configurable per set).

**Definitions** bundle action sets together. They exist for layering: a "baseline" definition plus a "web-server" definition plus a "monitoring" definition, applied independently so an audit can see which set a given action came from.

**Device groups** are who the work runs on. Static groups are a hand-picked list. Dynamic groups are a query (`labels.environment equals "production"`) that recomputes membership whenever a device's inventory changes.

**Assignments** are the link. They say "run this action / set / definition on this device / user / group, in this mode." That's where work actually starts.

The agent picks dispatches off its mTLS stream, applies them idempotently against the desired state (`PRESENT` or `ABSENT`), and reports back an execution event the audit log captures verbatim.

{% callout type="info" title="Idempotent by default" %}
Where it makes sense (packages, files, users, services, sshd config, repositories, encryption) the agent checks current state before doing anything. Re-running the same action against a converged device is a no-op. Safe to re-dispatch on a schedule.
{% /callout %}

## Walk-through: install curl on production

Five steps. About two minutes if you already know your way around the UI.

### 1. Tag your devices

Open **Devices**, click into the agent you enrolled, and add a label. Convention is `key:value`. For this example, `environment:production`. Labels are how dynamic groups identify members.

### 2. Create the dynamic group

**Device groups** → **New group** → **Dynamic**.

Name it `production`. Query:

```
labels.environment equals "production"
```

Save. The member list shows every device carrying that label.

### 3. Create the action

**Actions** → **New** → **PACKAGE**.

| Field | Value |
|---|---|
| Name | `Install curl` |
| Package name | `curl` |
| Desired state | `PRESENT` |

Save. The action is in the catalogue but isn't running anywhere yet.

### 4. Assign it

**Assignments** → **New**.

| Field | Value |
|---|---|
| Action | `Install curl` |
| Target | device group `production` |
| Mode | `enforce` |

Save. On the next [reconciliation tick](/concepts/reconciliation) (default 5 minutes) every production agent picks up the dispatch.

### 5. Watch it land

The device's **Executions** tab shows the dispatch within a few seconds. Devices that already have curl finish as a no-op. The rest run apt / dnf / pacman / zypper depending on distro, with the full output captured in the execution event.

The same execution events feed the audit log under **Audit** → **Executions**, indexed by device, action, time range, and status.

## What's next

Once one action works end-to-end, the patterns scale.

Group related actions into a set for ordered execution. The agent runs them in declared order and aborts on the first failure (you can opt out of the abort).

Schedule the assignment. Cron expressions or fixed intervals both work, and the agent's offline scheduler keeps running scheduled work while disconnected from the gateway. It reconciles when it reconnects.

Constrain *when* work runs with maintenance windows. A window attached to a device group bounds execution to specific hours in the device's local timezone. See [Maintenance windows](/concepts/maintenance-windows).

Layer compliance on top for drift detection that doesn't force convergence. Compliance policies evaluate the same way actions do but only report status. Pick that mode when remediation is risky enough that you want a human in the loop.

## What not to do

Don't write actions that depend on each other across separate assignments. There's no ordering guarantee between assignments. If two actions need to run in sequence, put them in an action set.

Don't put secrets in `SHELL` scripts and assume the audit log redactor will save you. It scrubs `script` and `content` from the visible trail, but actual encrypted-at-rest storage lives under the dedicated primitives (`LPS` for local passwords, `ENCRYPTION` for LUKS, the IdP credential store for OAuth secrets). Use the right one.

Don't set `CONTROL_PASSWORD_AUTH_ENABLED=false` until you've added and tested an OIDC provider. Locking yourself out is recoverable but tedious.

## Where to read next

- [Architecture](/concepts/architecture) for how events flow from RPC to projection
- [Action reference](/action-reference) for every action type and its parameters
- [RBAC and scopes](/concepts/rbac) for who can do what
- [Security model](/security/threat-model) for trust boundaries and what each one guarantees
