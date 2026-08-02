---
title: APP_IMAGE
---
# APP_IMAGE

<!-- docref: begin src=agent:internal/executor/action_appimage.go#Executor.executeAppImage:4cef8a51 -->
Installs an AppImage binary. AppImages are portable, single-file Linux app bundles. The agent downloads the AppImage, verifies its SHA-256, marks it executable (mode 0755), and places it at `install_path`. That's it — there is **no automatic `.desktop` file creation, icon extraction, or menu integration** today; if you want that, ship the AppImage with a companion `FILE` action that drops the `.desktop` entry.

Default install location is `/opt/appimages/`.
<!-- docref: end -->

## Parameters

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#AppInstallParams:76caae4c,server:internal/authoring/state.go#validateActionSafety:d9103ea9,agent:internal/executor/action_rpm.go#requireVerifiedArtifact:5563f54d -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | yes | — | HTTPS URL to fetch the AppImage from. Plain `http://` is rejected. |
| `checksum_sha256` | string | yes | — | 64-char hex digest (the server requires lowercase; the agent compares case-insensitively). Mandatory for installs — the agent refuses an unverified binary. Removal needs no checksum. |
| `install_path` | string | no | `/opt/appimages` | Directory to install into. Must be absolute. |
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/action_appimage.go#Executor.executeAppImage:4cef8a51,agent:internal/executor/action_appimage.go#sha256File:fc1b5818 -->
The agent extracts the filename from the URL's last path segment and checks whether a file with that name already exists at `install_path`. If yes, it stream-hashes the file and compares the SHA-256 to detect drift. A matching checksum means `changed=false`; a mismatch triggers a re-download.
<!-- docref: end -->

## Example

Install Obsidian:

```yaml
type: APP_IMAGE
url: https://github.com/obsidianmd/obsidian-releases/releases/download/v1.5.3/Obsidian-1.5.3.AppImage
checksum_sha256: 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
desired_state: PRESENT
```

## Gotchas

<!-- docref: begin src=agent:internal/executor/action_appimage.go#sha256File:fc1b5818,agent:internal/executor/download.go#fetchArtifact:71cb53c3 -->
- Downloads stream straight into the destination directory and are hashed as they go, then atomically renamed into place — large AppImages (GB-scale) don't blow up memory, and a failed or mismatched download never clobbers an existing file.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/action_appimage.go#Executor.executeAppImage:4cef8a51 -->
- URL filenames are derived from the last path segment. AppImages with versioned filenames (`Obsidian-1.5.3.AppImage`) create version-specific files; upgrading involves a new action with the new URL.
- Old versions aren't cleaned up automatically. If you replace `Obsidian-1.5.3.AppImage` with `Obsidian-1.5.4.AppImage`, both files end up in `/opt/appimages/`. Use `FILE` with `desired_state: ABSENT` to clean old ones.
<!-- docref: end -->
<!-- docref: begin src=sdk:sys/fs/validate.go#ResolveAndValidatePath:bd1ff9c1 -->
- `install_path` must be absolute; symlinks in the existing part of the path are resolved before any write so a planted symlink can't redirect the install. There is no allowed-prefix restriction beyond that — pick a sensible system location yourself.
<!-- docref: end -->
