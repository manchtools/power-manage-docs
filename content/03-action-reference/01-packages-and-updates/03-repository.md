---
title: REPOSITORY
---
# REPOSITORY

Adds or removes a third-party package repository. Each backend (apt, dnf, pacman, zypper) has its own native config shape, so the parameter set is split per manager. Set only the fields for the managers you actually use on the target devices.

The agent validates every field aggressively. Newlines or shell metacharacters in any value are refused at parse time to prevent config injection.

## Parameters

Common:

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Repository identifier used for file naming. **Alphanumeric only, max 64 chars** (enforced by server-side validation — `._-` are accepted by the agent's executor but rejected by the proto validator before the action ever reaches the agent). |

APT (`/etc/apt/sources.list.d/<name>.list`):

| Field | Type | Description |
|---|---|---|
| `apt.url` | string | Repository URL. |
| `apt.distribution` | string | Distro codename (e.g. `bookworm`, `noble`). |
| `apt.components` | string[] | Components (e.g. `main`, `contrib`). |
| `apt.gpg_key_url` | string | URL to fetch the signing key from. |
| `apt.gpg_key` | string | Inline armoured key (alternative to `gpg_key_url`). |
| `apt.arch` | string | Architecture filter (`amd64`, `arm64`). |
| `apt.trusted` | bool | Skip signature check. Defaults `false`. |
| `apt.disabled` | bool | Commented-out entry. |

DNF (`/etc/yum.repos.d/<name>.repo`):

| Field | Type | Description |
|---|---|---|
| `dnf.baseurl` | string | Repo URL. |
| `dnf.description` | string | Human label. |
| `dnf.enabled` | bool | Defaults `true`. |
| `dnf.gpgcheck` | bool | Defaults `true`. |
| `dnf.gpgkey` | string | URL or inline armoured key. |
| `dnf.module_hotfixes` | bool | Allow non-module package updates. |

Pacman (`/etc/pacman.d/<name>.conf` and `/etc/pacman.conf` snippet):

| Field | Type | Description |
|---|---|---|
| `pacman.server` | string | Mirror URL. |
| `pacman.sig_level` | string | One of `Required`, `Optional`, `Never`. |

Zypper (`/etc/zypp/repos.d/<name>.repo`):

| Field | Type | Description |
|---|---|---|
| `zypper.url` | string | Repo URL. |
| `zypper.description` | string | Human label. |
| `zypper.enabled` | bool | Defaults `true`. |
| `zypper.autorefresh` | bool | Auto-refresh metadata. |
| `zypper.gpgcheck` | bool | Defaults `true`. |
| `zypper.gpgkey` | string | URL or inline key. |
| `zypper.type` | string | `rpm-md`, `yast2`, or `plaindir`. |

## Idempotency

The agent hashes the config file content (or matches against parsed lines for pacman/zypper) and skips writing when nothing's changed. GPG keys are fetched and checked into the keyring, then re-checked for fingerprint match.

`desired_state: ABSENT` removes the config file and the imported key.

## Example

Add the Docker apt repo on Debian:

```yaml
type: REPOSITORY
name: docker
apt:
  url: https://download.docker.com/linux/debian
  distribution: bookworm
  components: [stable]
  gpg_key_url: https://download.docker.com/linux/debian/gpg
desired_state: PRESENT
```

## Gotchas

- Repository names are validated as alphanumeric-only at the server boundary. Dots and dashes are filesystem-safe but the proto's `alphanum` rule refuses them — if you need them for parity with a vendor's repo-name convention, file a tracker so we can either loosen the rule or document the workaround.
- Inline GPG keys (`gpg_key`, `dnf.gpgkey`, `zypper.gpgkey`) are PEM-armoured. Raw binary keys are rejected.
- `apt.trusted: true` skips signature verification. Don't use it outside dev / preview repos.
- A repository action runs `apt update` (or distro equivalent) after the file changes, so the metadata cache is consistent for the next `PACKAGE` action.
