---
title: FLATPAK
---
# FLATPAK

Installs a Flatpak from a configured remote. Most fleets default to `flathub`; you can target a different remote (your own, a vendor's, an enterprise mirror).

## Parameters

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#FlatpakParams:9451b1ba,agent:internal/executor/action_flatpak.go#Executor.executeFlatpak:db63062a -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `app_id` | string | yes | — | Reverse-DNS application ID (e.g. `org.mozilla.firefox`). Max 255 chars; flag-shaped values are rejected. |
| `remote` | string | no | `flathub` | Remote name on the device. |
| `system_wide` | bool | no | `false` | `true` installs system-wide. **Unset means `false`**, which installs per-user — the web form pre-selects system-wide, but an API client that omits the field gets per-user. |
| `pin` | bool | no | `false` | Pin the app to prevent automatic updates (`flatpak mask`). |
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=sdk:pkg/flatpak.go#flatpak.IsInstalled:2f44a6da,sdk:pkg/flatpak.go#flatpak.Pin:6fb1023b,agent:internal/executor/action_flatpak.go#Executor.executeFlatpakSystem:2d4a72af -->
`flatpak info <app_id>` (scoped `--system` or `--user`) decides whether the app is installed. A match means `changed=false`. Pin state is checked separately via `flatpak mask` and converged even when the app was already installed — a requested pin that's missing gets applied, and a pin failure fails the action.

System-wide and per-user installs are different installations; the agent doesn't auto-convert between them. Setting `system_wide: false` after a system-wide install treats them as two distinct things.

`desired_state: ABSENT` runs `flatpak uninstall` (unmasking first, best-effort).
<!-- docref: end -->

## Example

System-wide Firefox from Flathub, pinned:

```yaml
type: FLATPAK
app_id: org.mozilla.firefox
remote: flathub
system_wide: true
pin: true
desired_state: PRESENT
```

## Gotchas

- The remote has to be configured on the device already (`flatpak remote-add`). Configuring a remote is a `SHELL` job for now.
<!-- docref: begin src=agent:internal/executor/action_flatpak.go#Executor.executeFlatpakPerUser:a64d295b -->
- Per-user installs (`system_wide: false`) run for **every currently signed-in graphical session**, as that user. With no one signed in, the action logs a warning and reports success as a no-op — it runs again on the next reconciliation tick once a user signs in. Per-user *removal* is broader: it reaches every account on the box that has the app, signed in or not.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/action_flatpak.go#Executor.executeFlatpak:db63062a -->
- If flatpak isn't installed on the device, the action reports the **Not applicable** status with the reason `flatpak not available on this system` — neither a failure nor a silent success. Use a `PACKAGE` action to ensure flatpak is present first.
<!-- docref: end -->
<!-- docref: begin src=sdk:pkg/flatpak.go#flatpak.Pin:6fb1023b,agent:internal/executor/action_flatpak.go#Executor.executeFlatpakSystem:2d4a72af -->
- Pinning uses `flatpak mask`. The mask is removed automatically on uninstall, but a `pin: false` re-dispatch does **not** drop an existing mask — the agent only converges the pin *on*. To unpin without removing the app, run `flatpak mask --remove` via `SHELL`.
<!-- docref: end -->
