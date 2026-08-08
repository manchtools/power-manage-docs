---
title: WIFI
---
# WIFI

<!-- docref: begin src=sdk:sys/network/network.go#Backend:11393461,agent:internal/executor/wifi.go#Executor.executeWifi:0390b66f -->
Manages a wireless network profile. **NetworkManager is the only backend, and there is no `backend` field to pick another.** The former ConnMan, wpa_supplicant, and iwd placeholder enum values are gone along with `WifiParams.backend` — the never-implemented scaffolds were not carried into the current design. The SDK still takes an explicit backend so a real second implementation can be added later, but `NetworkManager` is the only defined value; its zero value and anything else fail closed with `ErrUnknownBackend`. The action therefore always drives NetworkManager, and fails on hosts that don't run it. Two auth modes: pre-shared key (WPA2 / WPA3-Personal) and EAP-TLS (enterprise 802.1X with client certs).
<!-- docref: end -->

## Parameters

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#WifiParams:53420ab3,sdk:proto/powermanage/v1/actions.proto#WifiAuthType:3ad8fde8 -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `ssid` | string | yes | — | Network name. 1–255 chars. |
| `auth_type` | enum | yes | — | `PSK` or `EAP_TLS`. |
| `psk` | string | yes if PSK | — | Pre-shared key. Max 63 chars. |
| `ca_cert` | string | yes if EAP_TLS | — | PEM-encoded CA certificate. |
| `client_cert` | string | yes if EAP_TLS | — | PEM-encoded client certificate. |
| `client_key` | string | yes if EAP_TLS | — | PEM-encoded client private key. |
| `identity` | string | no | — | EAP identity (e.g. `user@corp.example`). Max 254 chars. |
| `auto_connect` | bool | no | `false` | Auto-connect when in range. The web UI pre-checks it. |
| `hidden` | bool | no | `false` | The network broadcasts no SSID (hidden network). |
| `priority` | int32 | no | `0` | Connection priority. Higher wins when multiple known networks are visible. -1 to 999. |

There is no `backend` field: the action always means NetworkManager.
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/wifi.go#wifiConnectionName:6ab949e7,sdk:sys/network/networkmanager.go#networkManager.Apply:fcf1543a,sdk:sys/network/networkmanager.go#networkManager.update:284c5e4c -->
A connection profile named `pm-wifi-<actionId>` is created in NetworkManager. On each tick, **EAP-TLS profiles are diffed** against the live settings (including the PEM contents on disk) and only rewritten on change. **PSK profiles are always rewritten** — NetworkManager can't read the PSK back to diff it, so a PSK action reports `changed=true` on every apply. The connection isn't activated by the action; it's configuration only. `auto_connect` controls whether NetworkManager picks it when it sees the SSID.
<!-- docref: end -->

<!-- docref: begin src=sdk:sys/network/networkmanager.go#networkManager.Delete:67643032 -->
`desired_state: ABSENT` deletes the profile and any associated certificate files.
<!-- docref: end -->

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

<!-- docref: begin src=sdk:sys/network/network.go#CertBaseDir:a04abcf1 -->
- Certificates and keys land in `/var/lib/power-manage/wifi/<actionId>/`. The client private key is written 0600; the PSK reaches NetworkManager via a 0600 keyfile under `/etc/NetworkManager/system-connections/`, never via argv.
<!-- docref: end -->
<!-- docref: begin src=server:internal/store/audit.go#AuditEffect:4a8afbb5,server:internal/authoring/secrets.go#Handlers.prepareWifiParams:e1269314,server:internal/manifest/compiler.go#Compiler.wifiParams:e94b8434,agent:internal/executor/sealing.go#Executor.executeSealedWifi:a0df8432 -->
- `psk` and `client_key` never reach the audit log, and there is no redaction schema to configure or forget. An audit effect has **no free-form value field at all**: it can record the *names* of changed fields, a reference to another row, a state flag, a count, a non-reversible digest, or per-subject sealed detail — nothing else is representable. A credential stays out of the trail by construction rather than by a filter list someone has to keep current.
- `psk` and `client_key` are write-only. Action reads return only whether each
  credential is configured; leaving an edit field empty preserves it. Control
  encrypts the authored value at rest and seals it to the selected device before
  persisting a delivery. Switching authentication mode removes the credential
  belonging to the old mode.
<!-- docref: end -->
- The action configures the profile but doesn't disconnect the current network. If the device is on Ethernet, it stays on Ethernet; the new Wi-Fi is only used when Ethernet drops or the user explicitly switches.
- `priority` maps to NetworkManager's `connection.autoconnect-priority` and resolves ties when several known networks are in range simultaneously; higher is preferred.
