---
title: REPOSITORY
---
# REPOSITORY

Adds or removes a third-party package repository. Each backend (apt, dnf, pacman, zypper) has its own native config shape, so the parameter set is split per manager. Set only the fields for the managers you actually use on the target devices; a `disabled: true` sub-config (or an absent one) makes the action report the **Not applicable** status on hosts running that manager.

<!-- docref: begin src=sdk:sys/repo/validate.go#manager.Validate:791c557d,sdk:sys/repo/validate.go#hasControl:a3e20977,agent:internal/executor/action_repository.go#Executor.executeRepository:f48b455f -->
The agent validates every field aggressively — before any privileged side effect. Control characters or newlines in any value are refused at validation time to prevent config injection, and the offending field is named without echoing its value.
<!-- docref: end -->

## Parameters

Common:

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#RepositoryParams.name:5ec81592,sdk:sys/repo/validate.go#validateName:8b5ba27c -->
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Repository identifier used for file naming. **Alphanumeric only, max 64 chars** (enforced by server-side validation — `._-` are accepted by the agent-side grammar but rejected by the proto validator before the action ever reaches the agent). |
<!-- docref: end -->

APT — written in deb822 format to `/etc/apt/sources.list.d/<name>.sources`, with the signing key dearmored into `/etc/apt/keyrings/<name>.gpg` and referenced via `Signed-By`:

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#AptRepository:b85e7783,sdk:sys/repo/repo.go#AptConfig:301a1d74 -->
| Field | Type | Description |
|---|---|---|
| `apt.url` | string | Repository URL. Deliberately not restricted to https — apt's trust anchor is the GPG-signed Release file. |
| `apt.distribution` | string | Distro codename (e.g. `bookworm`, `noble`). Empty selects a flat repository (`Suites: /`). |
| `apt.components` | string[] | Components (e.g. `main`, `contrib`). |
| `apt.gpg_key_url` | string | HTTPS URL the agent fetches the signing key from (capped at 10 MiB). |
| `apt.gpg_key` | string | Inline key (ASCII-armoured or binary), alternative to `gpg_key_url`. |
| `apt.arch` | string | Architecture filter (`amd64`, `arm64`). |
| `apt.trusted` | bool | Writes `Trusted: yes` (skips signature checking). Defaults `false`; honoured only when no key is configured — a key always wins. |
| `apt.disabled` | bool | Skip the apt config on this action entirely. |
<!-- docref: end -->

DNF — written to `/etc/yum.repos.d/<name>.repo`:

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#DnfRepository:a665871d,sdk:sys/repo/repo.go#DnfConfig:293e80af,sdk:sys/repo/dnf.go#manager.applyDnf:c628e81a -->
| Field | Type | Description |
|---|---|---|
| `dnf.baseurl` | string | Repo base URL (supports `$releasever` / `$basearch`). |
| `dnf.description` | string | Human label (the `.repo` `name=` field; defaults to the repo name). |
| `dnf.enabled` | bool | Writes `enabled=1/0`. **Unset means `enabled=0`** — set it explicitly. |
| `dnf.gpgcheck` | bool | Writes `gpgcheck=1/0`. **Unset means `gpgcheck=0`**, and the key is then neither written nor imported. |
| `dnf.gpgkey` | string | Key *reference* (https URL or absolute path) written as `gpgkey=` and imported with `rpm --import` — not inline key material. |
| `dnf.module_hotfixes` | bool | Writes `module_hotfixes=1` for modular content. |
| `dnf.disabled` | bool | Skip the dnf config on this action entirely. |
<!-- docref: end -->

Pacman — a section appended to `/etc/pacman.conf`:

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#PacmanRepository:7bda81df,sdk:sys/repo/repo.go#PacmanConfig:55f06a3c,sdk:sys/repo/pacman.go#manager.applyPacman:48d11c15 -->
| Field | Type | Description |
|---|---|---|
| `pacman.server` | string | Mirror URL (supports `$repo` / `$arch`). |
| `pacman.sig_level` | string | pacman `SigLevel` value, e.g. `Optional TrustAll` or `Required DatabaseOptional` (letters and spaces only). |
| `pacman.disabled` | bool | Skip the pacman config on this action entirely. |
<!-- docref: end -->

Zypper — configured through `zypper addrepo` / `modifyrepo`:

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#ZypperRepository:0189fb9d,sdk:sys/repo/repo.go#ZypperConfig:fc91e2c5,sdk:sys/repo/zypper.go#manager.applyZypper:159c1fe5 -->
| Field | Type | Description |
|---|---|---|
| `zypper.url` | string | Repo URL. |
| `zypper.description` | string | Display name (`modifyrepo --name`). |
| `zypper.enabled` | bool | `modifyrepo --enable/--disable`. **Unset means disabled** — set it explicitly. |
| `zypper.autorefresh` | bool | Auto-refresh metadata (`addrepo --refresh`). |
| `zypper.gpgcheck` | bool | When false, adds `--no-gpgcheck`. **Unset means gpgcheck off.** |
| `zypper.gpgkey` | string | Key *reference* imported with `rpm --import`. |
| `zypper.type` | string | Repository type (`addrepo --type`, e.g. `rpm-md`, `yast2`, `plaindir`). |
| `zypper.disabled` | bool | Skip the zypper config on this action entirely. |
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=sdk:sys/repo/apt.go#manager.applyApt:41e17944,sdk:sys/repo/apt.go#manager.updateAptKey:f3733dcc,sdk:sys/repo/dnf.go#manager.applyDnf:c628e81a,sdk:sys/repo/pacman.go#manager.applyPacman:48d11c15,sdk:sys/repo/zypper.go#manager.applyZypper:159c1fe5 -->
apt, dnf, and pacman compare the desired config against what's on disk and skip the write when nothing changed (`changed=false`): apt compares the deb822 source *and* the dearmored key bytes, dnf requires a byte-identical `.repo` file, pacman compares its rebuilt `pacman.conf`. zypper is the exception — it reconfigures via `removerepo` + `addrepo` on every run and always reports `changed=true`.
<!-- docref: end -->

<!-- docref: begin src=sdk:sys/repo/apt.go#manager.removeApt:5d399f01,sdk:sys/repo/dnf.go#manager.removeDnf:b2aae66f,sdk:sys/repo/pacman.go#manager.removePacman:5653c4c0,sdk:sys/repo/zypper.go#manager.removeZypper:1fdcf57a -->
`desired_state: ABSENT` removes the backend's config (the apt `.sources` file plus its keyring, the dnf `.repo` file, the pacman.conf section, or `zypper removerepo`). Removing an already-absent repository is a `changed=false` no-op. Keys imported into the rpm keyring (dnf/zypper) are not removed.
<!-- docref: end -->

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

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#RepositoryParams.name:5ec81592,sdk:sys/repo/validate.go#validateName:8b5ba27c -->
- Repository names are validated as alphanumeric-only at the server boundary. Dots and dashes are filesystem-safe but the proto's `alphanum` rule refuses them — if you need them for parity with a vendor's repo-name convention, file a tracker so we can either loosen the rule or document the workaround.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/action_repository.go#Executor.downloadAptKey:267f071b,sdk:sys/repo/repo.go#DnfConfig:293e80af -->
- Only apt takes inline key material (`apt.gpg_key`, armoured or binary) or a key URL the agent downloads (`apt.gpg_key_url`, https-only). `dnf.gpgkey` and `zypper.gpgkey` are *references* — an https URL or an absolute path the package manager resolves itself.
<!-- docref: end -->
<!-- docref: begin src=sdk:sys/repo/repo.go#AptConfig:301a1d74 -->
- `apt.trusted: true` skips signature verification. Don't use it outside dev / preview repos. It's ignored whenever a key is configured.
<!-- docref: end -->
<!-- docref: begin src=sdk:sys/repo/apt.go#manager.applyApt:41e17944,sdk:sys/repo/dnf.go#manager.applyDnf:c628e81a,sdk:sys/repo/pacman.go#manager.applyPacman:48d11c15,sdk:sys/repo/zypper.go#manager.applyZypper:159c1fe5 -->
- A repository action refreshes the metadata cache after the config changes (`apt update`, `dnf makecache --repo <name>`, `pacman -Sy`, `zypper refresh`), so the next `PACKAGE` action sees it. The refresh is non-fatal for reachability problems — a typo'd URL surfaces as a warning in the output, but the config still lands. The exception: if apt rejects the just-written source file at parse time, the write is rolled back and the action fails rather than leaving apt broken on the host.
<!-- docref: end -->
