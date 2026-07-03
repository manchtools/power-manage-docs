---
title: DEB
---
# DEB

Installs a `.deb` package from a URL. Used when the package isn't in a repository: vendor downloads, custom builds, internal-only software. The agent downloads the file, verifies its SHA-256, and installs it through `apt install <path>` so dependencies resolve from the configured repositories.

## Parameters

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#AppInstallParams:76caae4c,server:internal/api/action_validators.go#validateAppInstallParams:113e9432,agent:internal/executor/action_rpm.go#requireVerifiedArtifact:5563f54d -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | yes | — | HTTPS URL to fetch the `.deb` from. Plain `http://` is rejected. |
| `checksum_sha256` | string | yes | — | 64-char hex digest (the server requires lowercase; the agent compares case-insensitively). Mandatory — without it the binary's only authenticity would be TLS to a possibly-compromised origin. The agent refuses to install without it, independent of server validation. |
| `install_path` | string | no | — | Ignored for `DEB` — the artifact is downloaded to a system temp file and handed to the package manager. The field belongs to `APP_IMAGE`, which shares this proto message. |
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/action_deb.go#Executor.executeDeb:d5f8fa1c -->
The agent downloads the `.deb` to a temp file, reads the canonical package name out of the file's control metadata (`dpkg-deb`, via the SDK), then checks whether that package is already installed. If it is, `changed=false`. Otherwise the SDK installs the local file through `apt`, which resolves dependencies and runs maintainer scripts. Removal goes through `apt remove <name>` for the same reason.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/executor/action_deb.go#Executor.debAbsentPackageName:a2aeed29 -->
For `desired_state: ABSENT` the same download-and-read-name flow runs so the agent knows what to remove. (The URL filename isn't trusted as the package name; it often differs.) If the download fails — the artifact was deleted upstream after the install — the agent falls back to parsing the `name_version_arch.deb` filename so a stale-URL ABSENT can still converge to "already absent".
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

<!-- docref: begin src=agent:internal/executor/action_deb.go#Executor.executeDeb:d5f8fa1c -->
- The package name is extracted from the `.deb` control file, not parsed from the URL. URLs like `https://example/foo-utils-1.2.deb` won't mislead the agent.
- Dependencies are resolved from the device's configured repositories (the install runs through `apt`, not bare `dpkg -i`). If a dependency isn't available in any configured repo, the action fails — add a `REPOSITORY` or `PACKAGE` action ahead of it in the action set.
<!-- docref: end -->
<!-- docref: begin src=sdk:sys/remote/http.go#defaultHTTPClient:32293c49 -->
- The download uses Go's default HTTP transport, so system proxy settings (`HTTP_PROXY` / `HTTPS_PROXY` in the agent's environment) are honoured.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/download.go#fetchArtifact:37286b7a,agent:internal/executor/download.go#redirectForArtifact:dc140dbf -->
- Because the download is checksum-pinned, cross-origin redirects are followed (GitHub-style CDN bounces work); an `https → http` downgrade is refused at every hop.
<!-- docref: end -->
