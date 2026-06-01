---
title: FLATPAK
---
# FLATPAK

Installs a Flatpak from a configured remote. Most fleets default to `flathub`; you can target a different remote (your own, a vendor's, an enterprise mirror).

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `app_id` | string | yes | — | Reverse-DNS application ID (e.g. `org.mozilla.firefox`). Max 255 chars. |
| `remote` | string | no | `flathub` | Remote name on the device. |
| `system_wide` | bool | no | `true` | Install system-wide. If false, installs per-user. |
| `pin` | bool | no | `false` | Pin the app to prevent automatic updates. |

## Idempotency

`flatpak list --app` is checked for the app ID. Match means `changed=false`. Pin state is checked separately via `flatpak mask`.

System-wide and per-user installs are different keystreams; the agent doesn't auto-convert between them. Setting `system_wide=false` after a system-wide install treats them as two distinct things.

`desired_state: ABSENT` runs `flatpak uninstall`.

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

- The remote has to be configured on the device already (`flatpak remote-add`). Configuring a remote is a `SHELL` job for now; a dedicated `FLATPAK_REMOTE` action is on the roadmap.
- Per-user installs (`system_wide: false`) require the target user to have a logged-in session at install time, or the install runs at next login. The agent doesn't block on that.
- If flatpak isn't installed on the device, the action skips with a warning rather than failing. Use a `PACKAGE` action to ensure flatpak is present first.
- Pinning uses `flatpak mask`. To temporarily allow an update, drop the pin with `desired_state: PRESENT, pin: false`.
