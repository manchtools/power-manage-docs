# DEB

Installs a `.deb` package from a URL. Used when the package isn't in a repository: vendor downloads, custom builds, internal-only software. The agent downloads the file, verifies its SHA-256, and runs `dpkg -i`.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | yes | — | HTTPS URL to fetch the `.deb` from. |
| `checksum_sha256` | string | no | — | 64-char hex digest. Skip only for repos you trust the TLS chain of. |
| `install_path` | string | no | system tmp | Directory to download into before install. |

## Idempotency

The agent downloads the `.deb` to a temp file, runs `dpkg-deb -f` to extract the canonical package name from the file's metadata, then checks `dpkg -l <name>` to see if it's already installed.

For `desired_state: ABSENT` the same download-and-extract-name flow runs so the agent knows what to remove. (The URL filename isn't trusted as the package name; it often differs.)

If the package matches, `changed=false`. Otherwise `dpkg -i` runs.

## Example

Install a vendor-shipped agent for a monitoring tool:

```yaml
type: DEB
url: https://vendor.example/agent_2.4.1_amd64.deb
checksum_sha256: 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
desired_state: PRESENT
```

## Gotchas

- The package name is extracted from the `.deb` control file, not parsed from the URL. URLs like `https://example/foo-utils-1.2.deb` won't mislead the agent.
- `dpkg -i` doesn't resolve dependencies. If the `.deb` needs deps that aren't installed, the action fails. Put a `PACKAGE` action for the dependencies ahead of it in the action set.
- The download honours system proxy settings (via `HTTP_PROXY` / `HTTPS_PROXY` in the agent's environment).
- The checksum is optional. Skip it only when you trust the URL's TLS chain.
