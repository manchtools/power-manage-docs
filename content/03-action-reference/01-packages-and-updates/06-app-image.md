---
title: APP_IMAGE
---
# APP_IMAGE

Installs an AppImage binary with system integration. AppImages are portable, single-file Linux app bundles. The agent downloads the AppImage, verifies its SHA-256, marks it executable, and creates desktop integration (.desktop file, icon extraction) when the AppImage embeds metadata.

Default install location is `/opt/appimages/`.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | yes | — | HTTPS URL to fetch the AppImage from. |
| `checksum_sha256` | string | no | — | 64-char hex digest. |
| `install_path` | string | no | `/opt/appimages` | Directory to install into. |

## Idempotency

The agent extracts the filename from the URL path and checks whether a file with that name already exists at `install_path`. If yes, it compares SHA-256 to detect drift. If the file matches the checksum (or the checksum is unset and the file exists), `changed=false`.

## Example

Install Obsidian:

```yaml
type: APP_IMAGE
url: https://github.com/obsidianmd/obsidian-releases/releases/download/v1.5.3/Obsidian-1.5.3.AppImage
checksum_sha256: 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
desired_state: PRESENT
```

## Gotchas

- The agent's HTTP client streams the response and hashes as it goes, so large AppImages (GB-scale) don't blow up memory.
- URL filenames are derived from the last path segment. AppImages with versioned filenames (`Obsidian-1.5.3.AppImage`) create version-specific files; upgrading involves a new action with the new URL.
- Old versions aren't cleaned up automatically. If you replace `Obsidian-1.5.3.AppImage` with `Obsidian-1.5.4.AppImage`, both files end up in `/opt/appimages/`. Use `FILE` with `desired_state: ABSENT` to clean old ones.
- `install_path` is validated to be absolute and inside an allowed prefix. `/tmp` is rejected.
