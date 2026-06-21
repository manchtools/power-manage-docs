---
title: "SDK specification"
status: implemented
order: 11
description: Complete protobuf surface (6 files, 178 RPCs), capability library (27 packages), generated code, crypto primitives, and adversarial testing infrastructure.
---

# power-manage-sdk

## Overview

The SDK defines the contract between all power-manage components. Three layers:

1. **Protobuf definitions** (`proto/pm/v1/`) — 6 proto files, 178 RPCs total.
2. **Generated code** (`gen/go/`, `gen/ts/`) — Go + TypeScript stubs from `buf generate`.
3. **Capability library** (27 Go packages) — dependency-injected system management.

Module path: `github.com/manchtools/power-manage-sdk` (Go 1.25).

## Proto surface

### File catalog

| File | Lines | Contents |
|------|-------|----------|
| `common.proto` | ~120 | `ActionId`, `DeviceId`, `ExecutionStatus` (8 states), `AssignmentMode` (4 modes), shared enums |
| `actions.proto` | ~600 | 23 action type messages + param oneofs: Shell, ScriptRun, Package, Update, Repository, Deb, RPM, AppImage, Flatpak, Service, File, Directory, Reboot, Sync, User, Group, SSH, SSHD, AdminPolicy, Encryption, WiFi, AgentUpdate, LPS |
| `agent.proto` | ~30 | `AgentService` with 3 RPCs: `Stream` (bidi), `SyncActions`, `ValidateLuksToken` |
| `control.proto` | ~2800 | `ControlService` with 164 RPCs across 20 domains |
| `device_auth.proto` | ~25 | `DeviceAuthService` with 2 RPCs: `Enroll`, `GetEnrollmentStatus` |
| `internal.proto` | ~250 | `InternalService` with 9 RPCs: `VerifyDevice`, `ProxySyncActions`, `ProxyValidateLuksToken`, `ProxyGetLuksKey`, `ProxyStoreLuksKey`, `ProxyStoreLpsPasswords`, `ProxyValidateTerminalToken`, `ListGatewayTerminalSessions`, `TerminateGatewayTerminalSession` |

### RPC distribution

| Service | RPCs | Auth |
|---------|------|------|
| `ControlService` | 164 | JWT (access + refresh, optional TOTP) |
| `InternalService` | 9 | mTLS (gateway client cert) |
| `AgentService` | 3 | mTLS (agent client cert) |
| `DeviceAuthService` | 2 | Registration token (Unix socket) |
| **Total** | **178** | |

### Proto conventions

- **Every field crossing a trust boundary carries `@gotags validate:"..."` tag.**
  Required, ulid, min_len, max_len, gt, pattern, required_if constraints.
- **IDs are ULIDs** — `string value = 1` with `validate:"required,ulid"`.
- **Enums start at 1** — proto3 requires 0 for unspecified default.
- **`oneof` for action parameters** — 23 action types, each with its own params
  message inside a oneof field.
- **Backward compatibility enforced by `buf breaking`** against main branch.
  Field numbers are frozen once released.

## Generated code

### Go (`gen/go/pm/v1/`)

Produces message structs with `@gotags` validate tags, Connect-RPC clients
and handlers, and JSON/proto marshaling. Package `pmv1`.

### TypeScript (`gen/ts/pm/`)

Produces ES module classes, Connect-RPC transport-agnostic clients
(`createPromiseClient`), and TypeScript types. Uses `@bufbuild/protoc-gen-es`
and `@connectrpc/protoc-gen-connect-es`.

### Regeneration

```bash
cd sdk && make generate   # both Go and TypeScript
```

CI verifies regeneration produces no diff.

## Capability library

27 Go packages organized by system domain. Every capability follows the
injected shape: `Runner + Backend → Manager`.

### Design principles

1. **Explicit over clever** — the caller names the privilege tool
   (`exec.Sudo`, `exec.Direct`, `exec.Doas`) and backend (`pkg.Apt`,
   `service.Systemd`).
2. **No global state** — backend selection lives on the instance.
3. **Testable without a host** — `FakeRunner` asserts exact argv shapes.
4. **Mutations return `exec.Result`** — stdout, stderr, exit code.

### Package catalog

| Package | Files | Capability | Backends |
|---------|-------|-----------|----------|
| `pkg` | 10 | Package management | Apt, Dnf, Pacman, Zypper, Flatpak, AppImage, Deb, RPM |
| `sys/exec` | 9 | Command execution, privilege escalation | Sudo, Doas, Direct |
| `sys/exec/exectest` | 1 | Fake runner for tests | — |
| `sys/service` | * | Systemd service management | Systemd |
| `sys/user` | * | User/group management | ShadowUtils (useradd, usermod, groupadd, etc.) |
| `sys/encryption` | 7 | LUKS disk encryption | Cryptsetup, TPM |
| `sys/network` | * | Network configuration | NetworkManager, Netplan, SystemdNetworkd, WPA Supplicant, IWD, ConnMan |
| `sys/firewall` | 6 | Firewall management | Iptables, Nftables, Firewalld, UFW |
| `sys/dns` | 4 | DNS configuration | SystemdResolved, Resolvconf, NetworkManager |
| `sys/catrust` | 3 | CA trust store | update-ca-trust, update-ca-certificates |
| `sys/smart` | * | Disk health (SMART) | Smartctl |
| `sys/antivirus` | 3 | Antivirus scanning | ClamAV |
| `sys/osquery` | * | System introspection | Osqueryi |
| `sys/inventory` | * | Hardware/software inventory | Dmidecode, Lscpu, Lspci, Lsblk, Lsscsi, etc. |
| `sys/log` | * | Log collection | JournalCtl |
| `sys/notify` | * | Desktop notifications | NotifySend |
| `sys/desktop` | 5 | Desktop environment | Gnome, KDE (session listing, user run-as) |
| `sys/timesync` | * | Time synchronization | Timedatectl, Chronyc |
| `sys/terminal` | * | Remote terminal (PTY) | Script |
| `sys/remote` | * | Remote desktop | RDP, VNC |
| `sys/reboot` | * | System reboot | Systemctl reboot, Shutdown |
| `sys/fs` | * | Filesystem operations | Mkdir, Chown, Chmod, Copy, Remove |
| `sys/repo` | * | Repository management | Apt sources, Dnf repos, Zypper repos, Pacman mirrors |
| `sys/netconfig` | * | Network interface config | Ip, Ethtool |

### Testing infrastructure

| Package | Files | Purpose |
|---------|-------|---------|
| `sys/exec/exectest` | 1 | `FakeRunner` — asserts argv shape, scripts stdout/stderr, injects errors |
| `cryptotest` | 1 | Crypto test helpers |
| `archtest` | 2 | Architecture fitness functions — circular imports, package layering, proto validation coverage |
| `validate` | 1 | Proto validation test helpers |

## Shared infrastructure

| Package | Files | Purpose |
|---------|-------|---------|
| `crypto` | 2 | Certificate generation (CSR), cert parsing, ULID generation |
| `logging` | 1 | Structured logging adapter (slog shim) |
| `maintenance` | 1 | Maintenance window data types + validation |
| `verify` | 3 | Signature verification utilities |
| `client.go` | 1 | Shared Connect-RPC client construction |
| `url.go` | 1 | URL parsing + validation |

## Adversarial testing

`adversary/` package: attack simulations verifying protocol invariants —
forged task HMAC, key substitution, cross-actor binding, replay, downgrade.

## Container test strategy (proposed)

Multi-distro Docker stages in `test/Dockerfile.{debian,fedora,opensuse,archlinux}`.
Each stage is a known system state (stale lock, degraded service, missing tools).
Tests run real binaries against known states. See `docs/02-concepts/02-backends.md`.

## Invariants

1. **Proto files are the source of truth.** Generated code never hand-edited.
2. **Every proto field crossing a trust boundary has a validate tag.**
3. **`buf breaking` must pass against main.** Backward compatible.
4. **No global state in the capability library.** All injected.
5. **Backend selection is explicit.** Never auto-detect.
6. **All crypto calls carry domain-separation info tags.**
7. **ULIDs for all identifiers.** Never `crypto.randomUUID()`.
8. **docref anchors for all exported symbols** in SDK docs.
9. **Roundtrip tests for event payloads** — byte-identical marshal/unmarshal.
