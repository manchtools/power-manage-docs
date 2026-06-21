---
title: "Agent specification"
status: implemented
order: 12
description: Complete agent architecture — 8 internal packages, 25 executor action types, 3 SQLite migrations, offline scheduler, LUKS daemon, and fail-closed security model.
---

# power-manage-agent

## Overview

The agent runs on every managed Linux device. Architecture:

```
┌──────────────────────────────────────────────┐
│                agent process                  │
│                                               │
│  handler ──→ executor (25 action types)       │
│    │            │                             │
│    ├────────────┼──→ store (SQLite, 3 migs)   │
│    │            │                             │
│  scheduler ────→│   (offline dispatch)        │
│                                               │
│  credentials (mTLS cert + key)                │
│  deviceauth (enrollment socket)               │
│  luksd (LUKS passphrase daemon)              │
│                                               │
│  All executors use sdk/ (capability library)  │
└──────────────────────────────────────────────┘
```

## Internal packages

### `handler/` (3 files)

Gateway stream RPC handling:

| File | Purpose |
|------|---------|
| `handler.go` | Main stream handler — receives `ServerMessage`, dispatches to executor, streams back `AgentMessage` |
| `interfaces.go` | Interface definitions for executor, store, scheduler |
| `terminal.go` | Terminal session setup, PTY management, WebSocket relay |

### `executor/` (25 files)

Action execution — one file per action domain. Each executor validates input,
constructs argv via the SDK capability library, executes via the injected
`Runner`, and reports results.

| File | Action(s) | SDK package used |
|------|-----------|-----------------|
| `executor.go` | Dispatch routing, executor registry | — |
| `cmd.go` | Shell, ScriptRun | `sys/exec` |
| `action_package.go` | Package install/remove | `pkg` |
| `action_update.go` | System update | `pkg` |
| `action_repository.go` | Repository add/remove | `sys/repo` |
| `action_deb.go` | Standalone .deb install | `pkg` |
| `action_rpm.go` | Standalone .rpm install | `pkg` |
| `action_appimage.go` | AppImage install | `pkg` |
| `action_flatpak.go` | Flatpak install/remove | `pkg` |
| `action_service.go` | Systemd service enable/disable/start/stop | `sys/service` |
| `action_file.go` | File create/write/delete | `sys/fs` |
| `action_directory.go` | Directory create/delete | `sys/fs` |
| `action_reboot.go` | System reboot | `sys/reboot` |
| `action_user.go` | User create/modify/delete | `sys/user` |
| `group.go` | Group create/modify/delete | `sys/user` |
| `action_ssh.go` | SSH key + config management | SDK SSH helpers |
| `sudo.go` | Sudo/doas policy (AdminPolicy) | `sys/user` (sudoers/doas) |
| `wifi.go` | WiFi network configuration | `sys/network` |
| `luks.go` | LUKS encryption + key management | `sys/encryption` |
| `lps.go` | LPS password management | Internal proxy to control |
| `agent_update.go` | Self-update | Internal |
| `per_user.go` | Per-user action execution (user scope) | `sys/desktop` |
| `fs.go` | Filesystem helpers | `sys/fs` |
| `helpers.go` | Shared executor utilities | — |
| `verify_stream_rpc.go` | Stream RPC HMAC verification | `verify` |

### `scheduler/` (1 file)

Offline scheduling when disconnected from gateway:

- **Persistent queue** — actions in SQLite, not memory.
- **Crash recovery** — replays incomplete actions on restart.
- **Clock awareness** — monotonic clock surviving reboots.
- **Change detection** — re-executes only when parameters changed.
- **Maintenance window respect** — defers actions outside allowed windows.

### `store/` (2 files + 3 migrations)

SQLite persistence via `database/sql` with WAL mode:

| File | Purpose |
|------|---------|
| `store.go` | Database open, migration apply, action CRUD, result storage, dispatch queue, clock state, certificates |
| *(queries)* | sqlc-annotated queries |

Migrations:

| # | File | Content |
|---|------|---------|
| 001 | `initial_schema.sql` | Actions table, results table, dispatch queue, certificates, clock state |
| 002 | `settings.sql` | Agent settings (sync interval, labels) |
| 003 | `action_groups.sql` | Action group membership for atomic dispatch |

### `credentials/` (1 file)

mTLS certificate and private key management:
- Load certificate + key from SQLite store
- Renew certificate via `RenewCertificate` RPC at 80% of lifetime
- Pin certificate fingerprint to prevent substitution

### `deviceauth/` (2 files)

Enrollment via Unix socket at `/run/pm-agent/enroll.sock`:

| File | Purpose |
|------|---------|
| `enroll.go` | Enrollment client — connects to socket, sends registration token, receives signed certificate |
| `enroll_server.go` | (In control server) Socket server — validates token, signs CSR, returns certificate |

Rate-limited to 5 attempts per minute.

### `luksd/` (4 files)

LUKS passphrase daemon — serves disk encryption keys to initramfs during boot:

| File | Purpose |
|------|---------|
| `server.go` | Unix socket server — listens during boot window, serves keys |
| `client.go` | Client for initramfs to request keys |
| `protocol.go` | Wire protocol — request/response format |
| `enroller.go` | Key enrollment — registers new passphrases with LUKS slots |

Communicates over local Unix socket only. Keys encrypted at rest with AES-GCM.
Daemon shuts down after root filesystem is mounted.

### `archtest/` (2 files)

Architecture fitness functions:
- No dynamic SQL (only sqlc-generated queries)
- Protobuf JSON consistency
- Constant-time secret comparison
- `time.Now` usage patterns

## Execution model

### Action lifecycle

1. **Receive**: Gateway streams `SyncActions` response with pending dispatches.
   Each dispatch carries action ID, type, params, and HMAC signature.
2. **Verify HMAC**: Agent verifies signature against shared secret. Drops
   unsigned dispatches, raises `SecurityAlert`.
3. **Persist**: Action committed to SQLite before execution — crash-safe.
4. **Execute**: `executor` constructs argv via SDK, executes via injected
   `Runner` (sudo/doas/direct), captures stdout/stderr/exit code.
5. **Report**: Streams `ActionResult` back to gateway with status, exit code,
   output (secrets redacted).
6. **Mark complete**: SQLite row updated with result.

### Command output streaming

Long-running actions (ScriptRun, Package update) stream output chunks
(`OutputChunk` messages) to the gateway in real time, before completion.
The gateway relays these to the web UI for live terminal-like output.

## Security properties

### Fail-closed design

| Boundary | Failure mode |
|----------|-------------|
| Stream connection | Disconnect + exponential backoff retry |
| Certificate verification | Refuse connection, no actions |
| HMAC signature | Drop dispatch, raise SecurityAlert |
| Enrollment rate limit | 5 attempts/minute, then reject |
| SQLite corruption | Refuse to start, flag for operator |
| LUKS daemon | Shut down after boot window, no persistent listen |

### Secret handling

- **Never log secrets**: passwords, LUKS keys, tokens, private keys redacted
  from stdout/stderr before reporting.
- **Certificate private key**: stored in SQLite, loaded into memory, never
  serialized to logs or results.
- **LUKS passphrases**: served over local Unix socket only. Zeroed after use
  (`secureZero()`).
- **HMAC shared secret**: never persisted to disk; derived from certificate
  handshake.

### mTLS

- Agent presents client certificate signed by control server CA.
- Gateway verifies chain + CRL before accepting stream.
- Certificate renewal at 80% of lifetime.
- Agent proves private key possession during every TLS handshake.

## Invariants

1. **Never execute unsigned actions** — HMAC verification before every dispatch.
2. **Fail-closed on all security boundaries** — stream, certificate, signature,
   enrollment, LUKS.
3. **Persist before execute** — actions committed to SQLite before dispatching.
4. **No secrets in logs or results** — redacted before reporting.
5. **ULIDs for all internal identifiers.**
6. **SQLite with WAL mode** — enforced by pragma test.
7. **All crypto calls carry domain-separation info tags.**
8. **Credential material zeroed after use** — `secureZero()`.
9. **Generated queries only** — no dynamic SQL (archtest-enforced).
10. **Constant-time comparison** for all secret material (archtest-enforced).

## Configuration

- **CLI flags**: `--gateway-url`, `--enroll-socket`, `--data-dir`
- **Environment**: `PM_GATEWAY_URL`, `PM_DATA_DIR`
- **Systemd**: `power-manage-agent.service` — `After=network-online.target`,
  `Restart=always`, `RestartSec=5`

## ADR index

Agent-specific decisions in `server/docs/adr/`:

| ADR | Decision |
|-----|----------|
| 0003 | Action signing — full envelope HMAC |
| 0010 | LUKS passphrase daemon socket |
| 0011 | Agent update authenticity |
| 0012 | Package argv hardening |
| 0013 | Enrollment trust model |
| 0017 | Agent stream loop fail-closed |
