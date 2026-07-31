---
title: Quick start
---
# Quick start

You need one running control instance, a configured OIDC provider, and one
enrolled agent. See [Installation](/get-started/installation) first.

## The product model

- An **Action** is one unit of desired work.
- An **ActionSet** is an ordered list of actions with its own schedule and
  failure policy.
- A **Definition** groups ActionSets.
- A **device group** selects devices statically or with a dynamic query.
- An **assignment** connects an Action, ActionSet, or Definition to a target.

Assigning an Action or ActionSet creates one flat manifest. Assigning a
Definition creates one manifest per contained ActionSet. Duplicate authored
occurrences are preserved.

## Install a package on a group

1. Enrol a device and give it the label `environment:production`.
2. Create a dynamic device group with:

   `labels.environment equals "production"`

3. Create a PACKAGE action for `curl` with desired state `PRESENT`.
4. Assign the action to the production group.
5. Watch the per-action and manifest results in the device execution view.

Control commits the manifest and delivery record before attempting to send.
If a device is offline, delivery waits in PostgreSQL and is offered after
reconnect. The agent records durable receipt before control acknowledges
delivery, so a reconnect does not execute the same delivery twice.

## Scheduling and failure policy

ActionSets retain independent schedules and failure policies.
`on_failure` defaults to `CONTINUE`; choose `STOP` explicitly when later
actions must not run. The agent can execute already received work during a
temporary control outage.

## Secrets

Use dedicated secret-bearing actions for passwords and encryption material.
Secret protobuf fields are sealed to their recipient and must never be placed
in shell scripts, logs, errors, audit payloads, or support bundles.

## Where to read next

- [Action reference](/action-reference)
- [Reconciliation](/concepts/reconciliation)
- [RBAC and scopes](/concepts/rbac)
- [Maintenance windows](/concepts/maintenance-windows)
