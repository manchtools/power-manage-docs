---
title: "power-manage-agent specification"
status: implemented
order: 12
description: Architecture, execution model, offline scheduling, and security properties of the device agent.
---

# power-manage-agent

## Overview

The agent runs on every managed Linux device. It maintains a persistent mTLS
connection to the gateway, receives action dispatches, executes them against the
local system, and reports results. It continues operating when disconnected
(offline scheduling) and survives reboots (systemd service, persistent state).

## Architecture

```
┌─────────────────────────────────────────────┐
│                 agent process                │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ handler   │  │ executor │  │ scheduler │  │
│  │ (stream,  │  │ (action  │  │ (offline  │  │
│  │  sync,    │──│  exec,   │──│  dispatch,│  │
│  │  terminal)│  │  LUKS)   │  │  clock)   │  │
│  └──────────┘  └──────────┘  └───────────┘  │
│        │             │              │        │
│  ┌─────┴─────────────┴──────────────┴─────┐  │
│  │              store (SQLite)             │  │
│  │  actions · results · dispatch queue    │  │
│  │  clock · certificates · crash markers  │  │
│  └────────────────────────────────────────┘  │
│        │              │                      │
│  ┌─────┴──────┐ ┌─────┴────────┐            │
│  │ credentials│ │ deviceauth   │            │
│  │ (mTLS cert │ │ (enrollment  │            │
│  │  + key)    │ │  via socket) │            │
│  └────────────┘ └──────────────┘            │
│                                              │
│  ┌──────────┐  ┌──────────────────────────┐ │
│  │ luksd    │  │ sdk (capability library) │ │
│  │ (LUKS    │  │ pkg · service · user ·   │ │
│  │  daemon) │  │ ssh · crypt · net · fw   │ │
│  └──────────┘  └──────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## Internal packages

| Package | Responsibility |
|---------|---------------|
| `handler` | Gateway stream RPC handling — `SyncActions`, agent message dispatch, terminal session management, stream verification |
| `executor` | Action execution — one file per action type (package, service, file, directory, user, SSH, LUKS, etc.). Each executor validates input, constructs argv via the SDK, executes, and reports results. |
| `scheduler` | Offline scheduling — dispatches queued actions when disconnected, respects maintenance windows, detects changed executions |
| `store` | SQLite persistence — actions, execution results, dispatch queue, clock state, certificates, crash markers. Schema in `store/migrations/`. |
| `credentials` | mTLS certificate and key management — loading, renewal, pinning |
| `deviceauth` | Enrollment via Unix socket at `/run/pm-agent/enroll.sock` — registration token validation, certificate signing request, rate limiting |
| `luksd` | LUKS passphrase daemon — serves decryption keys to the initramfs during boot via a local Unix socket |
| `archtest` | Architecture fitness functions — compile-time and test-time structural invariant checks |

## Execution model

### Action lifecycle

1. **Receive**: Gateway streams a `SyncActions` response containing pending
   action dispatches. Each dispatch carries an action ID, type, parameters,
   and an HMAC signature.
2. **Validate**: Agent verifies the HMAC signature against the shared secret.
   Rejects unsigned or tampered dispatches.
3. **Execute**: `executor` package constructs the argv for the action type
   using the SDK capability library. The SDK's injected `Runner` handles
   privilege escalation (sudo/doas/direct).
4. **Report**: Agent streams back `ActionResult` messages with status
   (SUCCESS, FAILED, TIMEOUT), exit code, stdout, and stderr.
5. **Persist**: Results are stored in SQLite for crash recovery and offline
   reporting.

### Action types

23 action types organized by domain:

| Domain | Action types |
|--------|-------------|
| Packages | Package (install/remove), Update, Repository, Deb, RPM, AppImage, Flatpak |
| System | Shell, ScriptRun, Service, File, Directory, Reboot, Sync |
| Identity | User, Group, SSH, SSHD, AdminPolicy, LPS |
| Security | Encryption (LUKS), WiFi |
| Lifecycle | AgentUpdate |

### Offline scheduling

When the agent loses its gateway connection, the scheduler continues
dispatching queued actions:

- **Persistent queue**: Actions are stored in SQLite, not held in memory.
- **Crash recovery**: On restart, the agent replays incomplete actions.
- **Clock awareness**: The scheduler respects maintenance windows using a
  monotonic clock that survives reboots.
- **Change detection**: The scheduler detects when an action's parameters
  have changed since last execution, re-executing only what's needed.

## Security properties

### mTLS

- Agent presents a client certificate signed by the control server CA.
- Gateway verifies the certificate chain and checks CRL.
- Certificate renewal at 80% of lifetime via `RenewCertificate` RPC.
- Agent proves possession of the private key during every stream
  handshake.

### Enrollment

- Socket-based enrollment at `/run/pm-agent/enroll.sock` (mode 0666).
- No sudo required — socket permissions control access.
- Registration token is the sole authorization.
- Rate-limited to 5 attempts per minute.
- Enrollment produces a signed certificate stored in SQLite.

### Action signing

- Every action dispatch carries an HMAC-SHA256 signature.
- Agent verifies the signature before execution.
- A compromised gateway or Redis cannot forge actionable dispatches
  without the shared secret.

### LUKS daemon

- `luksd` serves disk encryption keys to the initramfs during boot.
- Communicates over a local Unix socket, never over the network.
- Keys are encrypted at rest with AES-GCM (domain-separated info tags).
- The daemon only responds during the boot window; it shuts down after
  the root filesystem is mounted.

### Fail-closed

- Stream verification failures → disconnect and retry with backoff.
- Certificate verification failure → no actions executed.
- HMAC verification failure → dispatch dropped, security alert raised.
- SQLite corruption → agent refuses to start, flags for operator
  intervention.

## Testing

### Unit tests

Table-driven tests using `FakeRunner` from the SDK's `exectest` package.
Assert exact argv shapes, stdout/stderr scripting, and error injection.

### Integration tests

Tests against real binaries where available. Skip silently if the tool is
absent (`//go:build integration`).

### Container tests (proposed)

Multi-distro Docker stages testing against real system tools in known
states. See `agent/docs/container-test-strategy.md`.

### Architecture fitness functions

`archtest/` enforces structural invariants: no dynamic SQL (only sqlc),
protobuf JSON consistency, constant-time secret comparison, and
`time.Now` usage patterns.

## Invariants

1. **Never execute unsigned actions.** HMAC verification before every
   dispatch.
2. **Fail-closed on all security boundaries.** Stream, certificate,
   signature, enrollment, LUKS.
3. **Persist before execute.** Actions are committed to SQLite before
   dispatching so crashes don't lose state.
4. **No secrets in logs or results.** Passwords, keys, and tokens are
   redacted from stdout/stderr before reporting.
5. **ULIDs for all internal identifiers.**
6. **SQLite with WAL mode.** Never rollback journal. Enforced by
   `pragma_test.go`.
7. **All crypto calls carry domain-separation info tags.**
8. **Credential material zeroed after use.** `secureZero()`, not
   `arr.fill(0)`.

## Configuration

The agent is configured via:

- **Command-line flags** — gateway address, enrollment socket path,
  SQLite database path.
- **Environment variables** — `PM_GATEWAY_URL`, `PM_DATA_DIR`.
- **Systemd service file** — auto-restart, dependency ordering
  (after network-online.target).

## ADR index

Agent-specific architectural decisions are documented in the server ADR
directory (`server/docs/adr/`) since they affect the full system:

| ADR | Decision |
|-----|----------|
| 0003 | Action signing — full envelope HMAC |
| 0010 | LUKS passphrase daemon socket |
| 0011 | Agent update authenticity |
| 0012 | Package argv hardening |
| 0013 | Enrollment trust model |
| 0017 | Agent stream loop fail-closed |
