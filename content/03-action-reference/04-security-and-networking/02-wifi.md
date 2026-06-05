---
title: WIFI
---
# WIFI

Manages a wireless network profile. **NetworkManager is the only backend implemented today.** ConnMan, wpa_supplicant, and iwd are reserved enum values in the proto so the action can grow other backends without a rename, but selecting one of them fails the action with `ErrBackendNotSupported`. Two auth modes: pre-shared key (WPA2 / WPA3-Personal) and EAP-TLS (enterprise 802.1X with client certs).

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `ssid` | string | yes | — | Network name. 1–255 chars. |
| `auth_type` | enum | yes | — | `PSK` or `EAP_TLS`. |
| `psk` | string | yes if PSK | — | Pre-shared key. Max 63 chars. |
| `ca_cert` | string | yes if EAP_TLS | — | PEM-encoded CA certificate. |
| `client_cert` | string | yes if EAP_TLS | — | PEM-encoded client certificate. |
| `client_key` | string | yes if EAP_TLS | — | PEM-encoded client private key. |
| `identity` | string | no | — | EAP identity (e.g. `user@corp.example`). Max 254 chars. |
| `auto_connect` | bool | no | `false` | Auto-connect when in range. |
| `hidden` | bool | no | `false` | The network broadcasts no SSID (hidden network). |
| `priority` | int32 | no | `0` | Connection priority. Higher wins when multiple known networks are visible. -1 to 999. |
| `backend` | enum | no | `NETWORKMANAGER` | `NETWORKMANAGER` (default and the only working value). `CONNMAN`, `WPA_SUPPLICANT`, and `IWD` are reserved enum slots; selecting one fails the action. |

## Idempotency

A connection profile named `pm-wifi-<actionId>` is created in the backend's native format. The agent diffs against the existing profile (if any) on each tick and rewrites it if anything changed. The connection isn't activated by the action; it's a configuration only. Auto-connect controls whether NetworkManager picks it when it sees the SSID.

`desired_state: ABSENT` deletes the profile and any associated certificate files.

## Example

WPA3 office network, auto-connect, high priority:

```yaml
type: WIFI
ssid: ACME-Corp
auth_type: PSK
psk: "<from password manager>"
auto_connect: true
priority: 100
desired_state: PRESENT
```

Enterprise EAP-TLS with client certs:

```yaml
type: WIFI
ssid: ACME-Corp-Secure
auth_type: EAP_TLS
identity: "alice@corp.example"
ca_cert: |
  -----BEGIN CERTIFICATE-----
  ...
  -----END CERTIFICATE-----
client_cert: |
  -----BEGIN CERTIFICATE-----
  ...
client_key: |
  -----BEGIN PRIVATE KEY-----
  ...
auto_connect: true
desired_state: PRESENT
```

## Gotchas

- Certificates and keys land in `/etc/NetworkManager/certs/<actionId>/` (or backend equivalent). They're readable by root only.
- `psk` and `client_key` are redacted in the audit log. The values are stored encrypted at rest on the control server.
- The action configures the profile but doesn't disconnect the current network. If the device is on Ethernet, it stays on Ethernet; the new Wi-Fi is only used when Ethernet drops or the user explicitly switches.
- `priority` resolves ties when several known networks are in range simultaneously. Different backends weight it slightly differently; NetworkManager treats higher as preferred.
