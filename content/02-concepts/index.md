---
title: Concepts
icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4.5 10H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-.5'/><path d='M4.5 14H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-.5'/><path d='M6 18h.01'/><path d='M6 6h.01'/><circle cx='12' cy='12' r='3'/></svg>"
---

# Concepts

Product concepts. System architecture lives only in the workspace target
design; these pages explain operator-visible behavior.

- [**Reconciliation**](/concepts/reconciliation) — desired state, drift detection, and idempotent actions.
- [**RBAC and scopes**](/concepts/rbac) — dynamic roles, user groups, and `:self` / `:assigned` permission scopes.
- [**Dynamic device groups**](/concepts/dynamic-groups) — the query language that drives assignment targeting.
- [**Maintenance windows**](/concepts/maintenance-windows) — when actions are allowed to actually run.
- [**Compliance**](/concepts/compliance) — detection-only SHELL actions that flag drift without remediating it.
- [**Device inventory**](/concepts/device-inventory) — what the agent reports about each device, baseline + osquery layered.
- [**Log collection**](/concepts/log-collection) — on-demand journalctl queries dispatched from the UI.
- [**osquery**](/concepts/osquery) — opt-in integration for richer inventory and ad-hoc SQL queries.
- [**SSO (OIDC)**](/concepts/sso) — identity providers, the login flow, identity linking, and auto-provisioning.
- [**SCIM provisioning**](/concepts/scim) — automated user and group sync from your IdP, token handling, deprovisioning.
- [**Search**](/concepts/search) — SQLite FTS5 with an application-owned matcher and stable user-visible semantics.
