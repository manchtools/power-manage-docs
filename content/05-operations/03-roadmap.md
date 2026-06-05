---
title: Roadmap
---
# Roadmap

What's shipping in the current release, what's tracked for the next one, and what's deliberately *not* on the list yet. Everything below maps to a tracked issue in `manchtools/power-manage-server` — items without one are aspirations and stay off this page until they have a tracker.

Treat this page as a snapshot. The canonical source for *commitment* is the server repo's `ROADMAP-<release>.md` and the milestone tracker; the canonical source for *what already shipped* is the changelog and `git log`.

## v2026.06 — released as rc2

| Area | What landed |
|---|---|
| Event-sourcing core | All 11 PL/pgSQL projectors migrated to in-process Go listeners. The PL/pgSQL dispatcher table is gone. |
| mTLS | SPIFFE peer-class SANs enforced on every inter-service connection, not just agent ↔ gateway. |
| Action validation | Inline param validation at the API boundary — actions reject malformed input before they reach the agent. |
| Asynq | Mandatory HMAC envelope on every queued task between control, gateway, and indexer. |
| Maintenance windows | Per-group windows, evaluated in the device's local timezone. |
| Action types | `UNINSTALL` assignment mode wired through the agent; serial action-set execution with abort-on-first-failure; one-shot scheduled dispatch. |
| Handlers | Per-handler files in `server/internal/api/`; god-handlers split, consistent error mapping. |

The 2026.06 rc carries forward into rc-testing during the 2026.07 window — bugs surfaced in rc-testing get patched into the 2026.06 line, not deferred.

## v2026.07 — in flight

Tracked in `manchtools/power-manage-server#320`. The headline is the **valkey-search cutover** (replaces the RediSearch dependency that doesn't ship in current valkey releases). Around it:

| Area | Issue(s) |
|---|---|
| valkey-search cutover | server#320 (umbrella) |
| Terminal admin RBAC model | `TerminalAdminLimited` / `TerminalAdminFull` preset roles + scoped device-group RBAC. Slipped from 2026.06. |
| 2026.06 rc-testing follow-ups | Bug fixes surfaced during 2026.06 rollout — patched into 2026.06.x, not 2026.07. |
| Notifications foundation (server#5) | First slice of the notification subsystem the REBOOT doc references. Probably *not* finishing in 2026.07; tracked here so it isn't forgotten. |

The full Phase 2 / Phase 3 work from the original 2026.06 plan that didn't land — terminal-admin ADRs, `SECURITY.md`, the five named ADRs — is being broken down into individual issues during 2026.07 rather than tracked as a phase.

## Explicitly deferred (no milestone yet)

These have a tracking issue but no committed release. Each line is what's *known* about why it's deferred — the issue is the source of truth.

| Item | Status |
|---|---|
| Group variables | **Reverted in PR #239** with a written postmortem. Reopening needs: secret-taint infrastructure across every sink (UI, logs, audit, exports), a threat-model ADR, and a rendering-boundary ADR. Indefinitely postponed; not actively worked. |
| Auditd rule management | Held until the SIEM / event-forwarding integration story is real; shipping auditd without forwarding produces noise without value. |
| Dashboards + alerting | Adjacent to compliance reporting; held until compliance projections stabilise. |
| `RevokeCertificate` RPC + per-fingerprint deny-list | The right shape is "lazy revocation list at the gateway." Tracked but not scheduled. |
| Live trust-bundle reload (no restart) | `SetTrustBundle` already supports multi-CA at boot; SIGHUP / RPC reload is the missing piece. |
| Admin-initiated force-renew | RPC + audit event. Currently only agent-initiated renewal at 80% lifetime exists. |
| Active-active control + leader election | Today control is single-writer. Needed before "multiple control servers" stops being a "no" in the [FAQ](/operations/faq). |
| CA role separation (agent CA / inter-service CA / HTTPS CA independently rotatable) | A single CA root signs everything today. The split would let `RotateAgentCA` not also touch the gateway's server cert. |
| `power-manage` CLI driver for terminal sessions | Today the terminal is web-UI-only. A WebSocket-aware CLI client would let CI / scripts open sessions. |
| Cryptographic checkpointing of the audit log | Off-host hash chains and signed periodic anchors. Stronger tamper-evidence than schema-level append-only. |
| Retention-report tool | Estimate the cost of a given retention horizon. Form (CLI / RPC / dashboard widget) undecided. |
| Multi-region gateway topology | Partially supported via Redis self-registration; needs documented + tested deployment shape. |

## Not on the roadmap

If you're looking for these and didn't find them above, they're explicitly *not* planned:

- **Windows / macOS agent.** Linux-only. The agent depends on Linux subsystems (systemd, LUKS, journald, /etc/sudoers, package managers); porting is more than a build-target change.
- **Bundled web UI for self-hosting.** The hosted UI at `app.power-manage.manchtools.com` connects to your control server; there's no on-prem UI image. Build one against the Connect-RPC API if you need to.
- **Server-side SIEM uploader.** Use host-level tooling shipped via `SERVICE` actions or poll `ListAuditEvents`.

## Where to follow along

- Issues + PRs in `manchtools/power-manage-server` (server tracker).
- Milestone trackers per release: `ROADMAP-<release>.md` in the server repo.
- ADRs (once they land): `server/docs/adr/`. The directory does not exist yet; the first ADR creating it ships with whichever larger piece of work needs it first.
