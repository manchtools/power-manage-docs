---
title: DEB
---
# DEB

Installs a `.deb` package from a URL. Used when the package isn't in a repository: vendor downloads, custom builds, internal-only software. The agent downloads the file, verifies its SHA-256, and installs it through `apt install <path>` so dependencies resolve from the configured repositories.

## Parameters

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#AppInstallParams:76caae4c,server:internal/authoring/state.go#validateActionSafety:d9103ea9,agent:internal/executor/action_rpm.go#requireVerifiedArtifact:5563f54d -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | yes | — | HTTPS URL to fetch the `.deb` from. Plain `http://` is rejected. |
| `checksum_sha256` | string | yes | — | 64-char hex digest (the server requires lowercase; the agent compares case-insensitively). Mandatory — without it the binary's only authenticity would be TLS to a possibly-compromised origin. The agent refuses to install without it, independent of server validation. |
| `install_path` | string | no | — | Ignored for `DEB` — the artifact is downloaded to a system temp file and handed to the package manager. The field belongs to `APP_IMAGE`, which shares this proto message. |
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/action_deb.go#Executor.executeDeb:c38446d8 -->
The agent downloads the `.deb` to a temp file, reads the canonical package name out of the file's control metadata (`dpkg-deb`, via the SDK), then checks whether that package is already installed. If it is, `changed=false`. Otherwise the SDK installs the local file through `apt`, which resolves dependencies and runs maintainer scripts. Removal goes through `apt remove <name>` for the same reason.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/executor/action_deb.go#Executor.debAbsentPackageName:c940d828 -->
For `desired_state: ABSENT` the same download-and-read-name flow runs so the agent knows what to remove — but only when the artifact is verifiable (https + checksum): origin-served control-file bytes may only pick the removal target after checksum verification, so with no verifiable checksum the agent derives the name from the signed URL instead. The same `name_version_arch.deb` filename fallback covers a failed download — the artifact was deleted upstream after the install — so a stale-URL ABSENT still converges to "already absent".
<!-- docref: end -->

## Example

Install a vendor-shipped agent for a monitoring tool:

```yaml
type: DEB
url: https://vendor.example/agent_2.4.1_amd64.deb
checksum_sha256: 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
desired_state: PRESENT
```

## Gotchas

<!-- docref: begin src=agent:internal/executor/action_deb.go#Executor.executeDeb:c38446d8 -->
- On a host without a deb backend (no apt), the action reports the **Not applicable** status with the reason `no supported .deb package manager available on this system` — it is neither a failure nor a silent success.
- The package name is extracted from the `.deb` control file, not parsed from the URL. URLs like `https://example/foo-utils-1.2.deb` won't mislead the agent.
- Dependencies are resolved from the device's configured repositories (the install runs through `apt`, not bare `dpkg -i`). If a dependency isn't available in any configured repo, the action fails — add a `REPOSITORY` or `PACKAGE` action ahead of it in the action set.
<!-- docref: end -->
<!-- docref: begin src=sdk:sys/remote/http.go#defaultHTTPClient:32293c49 -->
- The download uses Go's default HTTP transport, so system proxy settings (`HTTP_PROXY` / `HTTPS_PROXY` in the agent's environment) are honoured.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/download.go#fetchArtifact:71cb53c3,agent:internal/executor/download.go#redirectForArtifact:dc140dbf -->
- Because the download is checksum-pinned, cross-origin redirects are followed (GitHub-style CDN bounces work); an `https → http` downgrade is refused at every hop.
<!-- docref: end -->
