---
title: Action architecture
---
# How actions are built

Actions are not 1-to-1 wrappers around shell commands. They're declarative, typed operations that compose small system primitives from the SDK. That's why the action surface is short — twenty-odd action types — but the things you can express are broad: `USER` covers half a dozen `useradd`, `usermod`, `chage`, `passwd`, and AccountsService calls, and `ENCRYPTION` covers cryptsetup *and* systemd-cryptenroll *and* on-disk state tracking.

Understanding the layering matters when you're picking the right action type, when you're reading an execution trace, and when you (or someone consuming the SDK) want to add a new action.

## The three layers

```
┌──────────────────────────────────────────────┐
│  Proto:  action types + params (the wire)    │  ← sdk/proto/pm/v1/actions.proto
├──────────────────────────────────────────────┤
│  Executor: per-type method on the agent      │  ← agent/internal/executor/*
├──────────────────────────────────────────────┤
│  SDK system primitives (the substrate)       │  ← sdk/go/sys/*, sdk/go/pkg, sdk/go/verify
└──────────────────────────────────────────────┘
```

**Proto** is the contract. Every action type is an enum value on `ActionType` and a params message glued into the `Action` oneof. Validation rules (`validate:` tags) and JSON canonicalisation rules are proto-level — the server validates once, the agent re-validates on receive.

**Executor** is per-action-type Go code in `agent/internal/executor/`. The dispatch is a single `switch` on `ActionType` in `executor.go`'s `Execute` method; each case calls a dedicated `executeXxx(ctx, params) (*CommandOutput, bool, error)` method (output, `changed` flag, error). The executor is where idempotency lives: every method first reads current state, compares to desired state, and short-circuits when they match.

**SDK system primitives** are the substrate. The agent doesn't call `os/exec` directly for privileged operations; it calls `sdk/go/sys/exec.Privileged()`. It doesn't call `cryptsetup` directly; it calls `sdk/go/sys/encryption`. The package-manager abstraction in `sdk/go/pkg/` detects whichever of apt/dnf/pacman/zypper/flatpak is installed and presents a single `Manager` interface.

This layering is why one `PACKAGE` action runs on Debian, Fedora, Arch, and openSUSE without per-distro branches in the action: the executor calls the SDK's `Manager`; the SDK figures out which backend to use.

## Why there isn't a 1:1 mapping to programs

The SDK substrate is the answer to "why doesn't `USER` just call `useradd`?" In practice:

- `useradd` doesn't manage `accountsservice` hide-from-GDM state. The executor does.
- `useradd` doesn't manage `~/.ssh/authorized_keys`. The executor does, append-if-missing.
- `useradd` doesn't track which password got set when, for LPS rotation. The agent's local state store does.

Each action type bundles whatever combination of SDK primitives is needed to converge the device to the declared state. That's the bargain you make for declarativeness: the executor is more code than the equivalent shell would be, but the action surface stays small.

## Substrate inventory

You'll see these all over the executor code:

- `sdk/go/sys/exec` — privileged subprocess execution (sudo / doas / direct, per `PrivilegeBackend`)
- `sdk/go/sys/fs` — file ops with path-traversal and protected-prefix guards
- `sdk/go/sys/user` — useradd / usermod / groupadd, AccountsService, authorized_keys
- `sdk/go/sys/service` — service manager abstraction (systemd today; OpenRC / runit / s6 are enum-reserved)
- `sdk/go/sys/encryption` — LUKS only today; GELI / CGD are enum-reserved
- `sdk/go/sys/luks` — LUKS-specific primitives (keyslot mgmt, header backup)
- `sdk/go/sys/systemd`, `sdk/go/sys/notify`, `sdk/go/sys/osquery`, `sdk/go/sys/inventory` — domain helpers
- `sdk/go/pkg` — package manager abstraction (apt / dnf / pacman / zypper / flatpak)
- `sdk/go/verify` — SHA-256 helpers for binary integrity (used by AGENT_UPDATE, DEB, RPM, APP_IMAGE)
- `sdk/go/crypto` — AES-GCM helpers for at-rest secrets

The split between `sdk/go/sys/encryption` (abstraction) and `sdk/go/sys/luks` (concrete) is the "Pattern A" backend selector described in [`sdk/docs/backend-pattern.md`](https://github.com/manchtools/power-manage-sdk). It's how new backends land later without breaking the action's proto.

## Adding a new action type

The shape of the work, if you're working inside this codebase or as a downstream SDK consumer:

1. **Proto** — add the enum value to `ActionType`, define a params message, plug it into the `Action` oneof, regenerate (`cd sdk && make generate`).
2. **Server validator** — server-side input checks land in `server/internal/api/action_validators.go`. Most actions only need the proto-level `validate:` tags; cross-field rules live here.
3. **Agent executor** — add the `case` in `executor.go` and the method body. Read current state through SDK primitives; short-circuit when desired == current; emit a structured `CommandOutput`.
4. **Web form** — register the action's form schema and renderer in `web/src/lib/forms/`.

The standing rule (see CLAUDE.md): shared utilities go in the SDK first, not in the first consumer. If the executor needs a primitive that doesn't exist yet — say, parsing a new on-disk format — it goes under `sdk/go/sys/<thing>` and gets a unit-test suite there, not buried inside `action_xxx.go`.

## What this gives you operationally

- **Idempotency is structural, not aspirational.** The current-state read is in the same method as the desired-state apply.
- **Adding distro support is cheap.** Add a backend to the SDK; every action that uses it gets it.
- **Auditing is uniform.** Every action emits `ExecutionCreated` / `ExecutionCompleted` / `ExecutionFailed` regardless of what it ran, with the same payload shape.
- **The agent stays small.** The action surface doesn't grow per backend; the SDK substrate does.
