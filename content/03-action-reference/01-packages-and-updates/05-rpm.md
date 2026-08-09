---
title: RPM
---
# RPM

Installs an `.rpm` package from a URL. Same shape as `DEB`, different backend. Used for vendor downloads, custom builds, internal-only software on Fedora / RHEL / openSUSE. The agent downloads the file, verifies its SHA-256, and installs it through `dnf`/`zypper install <path>` so dependencies resolve from the configured repositories.

## Parameters

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#AppInstallParams:76caae4c,server:internal/authoring/state.go#validateActionSafety:3d2a12fb,agent:internal/executor/action_rpm.go#requireVerifiedArtifact:5563f54d -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | yes | — | HTTPS URL to fetch the `.rpm` from. Plain `http://` is rejected. |
| `checksum_sha256` | string | yes | — | 64-char hex digest (the server requires lowercase; the agent compares case-insensitively). Mandatory — the agent refuses to install without it, independent of server validation. |
| `install_path` | string | no | — | Ignored for `RPM` — the artifact is downloaded to a system temp file and handed to the package manager. The field belongs to `APP_IMAGE`, which shares this proto message. |
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/action_rpm.go#Executor.executeRpm:8acb6864 -->
The agent downloads the `.rpm` to a temp file, reads the canonical package name from the header (`rpm -qp %{NAME}`, via the SDK), then checks the device. If the package is already installed, `changed=false`. Otherwise the SDK installs the local file through `dnf`/`zypper`, which resolves dependencies. Removal goes through `dnf`/`zypper remove <name>` so the scriptlets run properly.

Removal (`desired_state: ABSENT`) re-downloads to read the name before removal. If the URL is dead, the action fails with an explicit "cannot determine rpm package to remove" error — unlike `DEB`, an rpm filename has no reliable name field (names can contain hyphens), so there is no URL fallback.
<!-- docref: end -->

## Example

Install a vendor-shipped agent:

```yaml
type: RPM
url: https://vendor.example/agent-2.4.1.x86_64.rpm
checksum_sha256: 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
desired_state: PRESENT
```

## Gotchas

<!-- docref: begin src=agent:internal/executor/action_rpm.go#Executor.executeRpm:8acb6864 -->
- On a host without an rpm backend (no dnf/zypper), the action reports the **Not applicable** status with the reason `no supported .rpm package manager available on this system` — it is neither a failure nor a silent success.
- The package name comes from the rpm header itself, not the filename.
- Dependencies are resolved from the device's configured repositories (the install runs through `dnf`/`zypper`, not bare `rpm -i`). If a dependency isn't available in any configured repo, the action fails — add a `REPOSITORY` or `PACKAGE` action ahead of it.
- Per-file GPG signatures are **not** checked: the install passes `--nogpgcheck` / `--allow-unsigned-rpm`. The artifact's trust model is verified HTTPS plus the mandatory SHA-256 checksum — operator-provided rpms typically carry no signature, and the package manager must not reject them as unsigned.
<!-- docref: end -->
<!-- docref: begin src=sdk:sys/remote/http.go#defaultHTTPClient:32293c49 -->
- The download uses Go's default HTTP transport, so system proxy settings (`HTTP_PROXY` / `HTTPS_PROXY` in the agent's environment) are honoured.
<!-- docref: end -->
