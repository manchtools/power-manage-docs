---
title: RPM
---
# RPM

Installs an `.rpm` package from a URL. Same shape as `DEB`, different backend. Used for vendor downloads, custom builds, internal-only software on Fedora / RHEL / openSUSE.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | yes | — | HTTPS URL to fetch the `.rpm` from. |
| `checksum_sha256` | string | no | — | 64-char hex digest. Skip only for repos you trust the TLS chain of. |
| `install_path` | string | no | system tmp | Directory to download into before install. |

## Idempotency

The agent downloads the `.rpm` to a temp file, runs `rpm -qp --qf "%{NAME}"` to read the canonical package name from the header, then checks `rpm -q <name>` against the device. If matched, `changed=false`. Otherwise `rpm -i` (or `rpm -U` if a different version is installed) runs.

Removal (`desired_state: ABSENT`) re-downloads to read the name before removal.

## Example

Install a vendor-shipped agent:

```yaml
type: RPM
url: https://vendor.example/agent-2.4.1.x86_64.rpm
checksum_sha256: 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
desired_state: PRESENT
```

## Gotchas

- The package name comes from the rpm header itself, not the filename.
- `rpm -i` doesn't resolve dependencies. For dependency resolution, install through `dnf install <url>` via a `SHELL` action, or use `PACKAGE` after configuring a repo.
- A signed RPM is verified against the keyring on install. Unsigned RPMs install with a warning unless `rpm --nosignature` is set globally on the device.
- The checksum is optional. Skip it only when you trust the URL's TLS chain.
