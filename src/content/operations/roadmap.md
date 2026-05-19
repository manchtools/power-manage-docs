# Roadmap

The current milestone is **2026.06**. The list below is what's in flight; what comes after lives further down.

This page reflects the milestone tracker as of mid-May 2026. The canonical source is `ROADMAP-2026.06.md` in the server repo. If anything here drifts from that file, trust the repo.

## 2026.06: in scope

### Phase 0 — hardening (weeks 1–2)

- Proto v1 consolidation. Removing the last of the v1alpha experimental fields.
- Peer-class mTLS hardening: SPIFFE SANs enforced on every inter-service connection, not just agent-to-gateway.
- Handler refactor: per-handler files, consistent error mapping, removed god-handlers.
- Inline action validation: every action's parameters validate at the API boundary, not just inside the agent.
- CA role separation: the agent CA, inter-service CA, and HTTPS CA become independently rotatable.

### Phase 1 — fleet ergonomics (weeks 3–4)

- **`UNINSTALL` assignment mode.** A new mode alongside `enforce` / `report` that runs the action's reverse on the target. Replaces the current "set state to ABSENT and re-assign" dance.
- **Serial action-set execution.** Action sets execute in declared order with abort-on-first-failure (configurable). Today's behaviour is parallel with no ordering guarantee.
- **One-shot scheduled dispatch.** Delayed Asynq tasks let you say "run this at 03:00 tomorrow" without standing up a recurring schedule.
- **Per-group maintenance windows.** See [Maintenance windows](/concepts/maintenance-windows). Already partially landed; the milestone finishes the device-local timezone enforcement.

### Phase 2 — terminal admin model (weeks 5–7)

The remote terminal landed earlier; this phase ships its proper authorisation model.

- `TerminalAdminLimited` and `TerminalAdminFull` preset roles.
- Scoped device-group RBAC, so a `TerminalAdminLimited` user can only terminal into devices in groups they're assigned to.
- Open ADRs that have to close before this ships:
  - Sudo I/O capture: does `sudo` inside a session carry the operator identity through the privilege jump?
  - Editor-escape mitigation: how does `:!sh` from inside `vi` get captured?
  - TTY auth model: permanent, time-boxed, or operator-requested?

### Phase 3 — operability (week 8)

- `power-manage-control doctor` subcommand. Health-checks for the stack: certificate expiry, Postgres replication lag (if applicable), Valkey memory, Asynq dead queue, indexer drift, retention horizon.
- `SECURITY.md` covering the threat model, trust boundaries, secret handling, and the rotation playbooks.
- Five ADRs:
  - mTLS identity
  - Action signing
  - LPS / LUKS secret flow
  - Terminal trust model
  - Event-sourcing audit and tamper-evidence

## 2026.06: out of scope (deferred)

These were considered and explicitly pushed past the milestone window. Each has a reason.

| Feature | Why it's not in 2026.06 |
|---|---|
| Group variables | Need secret-taint infrastructure to redact variables consistently at every sink (UI, logs, audit, exports). Not finishable in-window. |
| Auditd rule management | Incomplete without a SIEM / event-forwarding integration. Ship together with that, not before. |
| Dashboards, alerting | Adjacent to compliance; designed-but-not-built. Held until compliance reporting is fully stable. |

## After 2026.06

Indicative, not committed:

- **Group variables** with proper secret tainting. Lets you parameterise actions per group without hard-coding values into the action body.
- **Native dashboards.** Per-fleet / per-group views combining inventory, compliance, and execution metrics. Without these you can already wire Grafana against the audit-log export, but the in-app version reduces the integration burden.
- **Cryptographic checkpointing of the audit log.** Off-host hash chains and signed periodic anchors for stronger tamper-evidence than the schema-level append-only.
- **Multi-region gateway topology.** Already partly supported via Valkey self-registration; the milestone makes it documented and tested.

## Where to follow along

- Issues and PRs in `manchtools/power-manage-server`
- The milestone tracker in the server repo: `ROADMAP-2026.06.md`
- ADRs (when they land): `server/docs/adr/`
