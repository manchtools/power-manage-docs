---
title: Action architecture
---
# How actions are built

<!-- docref: begin src=agent:internal/executor/action_user.go:fa2ad1e6,sdk:sys/user/accountsservice.go:f29e345c -->
Actions are not 1-to-1 wrappers around shell commands. They're declarative, typed operations that compose small system primitives from the SDK. That's why the action surface is short — twenty-odd action types — but the things you can express are broad: `USER` covers half a dozen `useradd`, `usermod`, `chage`, `passwd`, and AccountsService calls, and `ENCRYPTION` covers cryptsetup *and* systemd-cryptenroll *and* on-disk state tracking.
<!-- docref: end -->

Understanding the layering matters when you're picking the right action type, when you're reading an execution trace, and when you (or someone consuming the SDK) want to add a new action.

## The three layers

```
┌──────────────────────────────────────────────┐
│  Proto:  action types + params (the wire)    │  ← sdk proto/pm/v1/actions.proto
├──────────────────────────────────────────────┤
│  Executor: per-type method on the agent      │  ← agent/internal/executor/*
├──────────────────────────────────────────────┤
│  SDK system primitives (the substrate)       │  ← sdk sys/*, pkg/, verify/
└──────────────────────────────────────────────┘
```

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#ActionType:89f99edb,agent:internal/executor/executor.go#Executor.ExecuteWithStreaming:2b232bec -->
**Proto** is the contract. Every action type is an enum value on `ActionType` with a typed params message, and every dispatch travels as a CA-signed `SignedActionEnvelope`. Validation rules (`validate:` tags) are proto-level — the server validates at the boundary; the agent verifies the envelope's signature before executing.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/executor/executor.go#Executor.ExecuteWithStreaming:2b232bec,agent:internal/executor/executor.go#Executor.ExecuteEnvelope:d7ab4e1d -->
**Executor** is per-action-type Go code in `agent/internal/executor/`. The dispatch is a single `switch` on the envelope's `ActionType` in `executor.go`'s `ExecuteWithStreaming` method (`ExecuteEnvelope` is the non-streaming wrapper); each case calls a dedicated `executeXxx` method that takes the typed params (plus desired state where relevant) and returns a `CommandOutput`, a `changed` flag, and an error. The executor is where idempotency lives: every method first reads current state, compares to desired state, and short-circuits when they match.
<!-- docref: end -->

<!-- docref: begin src=sdk:sys/exec/runner.go#NewRunner:2a73f0a5,sdk:sys/exec/runner.go#PrivilegeBackend:01258357,sdk:pkg/pkg.go#Manager:48758d2d -->
**SDK system primitives** are the substrate. The agent doesn't call `os/exec` directly for privileged operations; it builds a `Runner` from the SDK's `sys/exec` package (`NewRunner(PrivilegeBackend)` — direct, sudo, or doas) and marks commands for escalation. It doesn't call `cryptsetup` directly; it calls `sys/encryption`. The package-manager abstraction in `pkg/` detects whichever of apt/dnf/pacman/zypper/flatpak is installed and presents a single `Manager` interface.
<!-- docref: end -->

This layering is why one `PACKAGE` action runs on Debian, Fedora, Arch, and openSUSE without per-distro branches in the action: the executor calls the SDK's `Manager`; the SDK figures out which backend to use.

## Why there isn't a 1:1 mapping to programs

The SDK substrate is the answer to "why doesn't `USER` just call `useradd`?" In practice:

- `useradd` doesn't manage `accountsservice` hide-from-GDM state. The executor does.
- `useradd` doesn't manage `~/.ssh/authorized_keys`. The executor does, append-if-missing.
- `useradd` doesn't track which password got set when, for LPS rotation. The agent's local state store does.

Each action type bundles whatever combination of SDK primitives is needed to converge the device to the declared state. That's the bargain you make for declarativeness: the executor is more code than the equivalent shell would be, but the action surface stays small.

## Substrate inventory

You'll see these all over the executor code (paths are relative to the SDK repo root):

<!-- docref: begin src=sdk:sys/exec/runner.go#Runner:7679445f,sdk:sys/fs/protected.go:c1d3dc9b,sdk:sys/user/accountsservice.go:f29e345c,sdk:sys/service/service.go:c5e7deaa,sdk:sys/encryption/encryption.go#Backend:11393461,sdk:pkg/pkg.go#Manager:48758d2d,sdk:verify/verify.go:aa5b34f4,sdk:crypto/aead.go:5d5e4331 -->
- `sys/exec` — privileged subprocess execution (direct / sudo / doas, per `PrivilegeBackend`)
- `sys/fs` — file ops with path-traversal and protected-prefix guards
- `sys/user` — useradd / usermod / groupadd, AccountsService, authorized_keys
- `sys/service` — service manager abstraction (systemd only; unknown backends fail closed)
- `sys/encryption` — disk encryption: LUKS today, including the `systemd-cryptenroll` TPM path; unknown backends fail closed
- `sys/notify`, `sys/osquery`, `sys/inventory`, `sys/log` — domain helpers
- `pkg` — package manager abstraction (apt / dnf / pacman / zypper / flatpak)
- `verify` — CA signing and verification of action envelopes and stream RPCs
- `crypto` — AES-GCM (AAD-bound) helpers for at-rest secrets
<!-- docref: end -->

<!-- docref: begin src=sdk:sys/encryption/encryption.go#Backend:11393461,sdk:sys/service/service.go:c5e7deaa,sdk:docs/02-concepts/02-backends.md:fc8a4141 -->
Packages like `sys/encryption` and `sys/service` take an explicit backend selector even while only one backend exists (LUKS, systemd) — the zero value is invalid and unknown backends return `ErrUnknownBackend`. That's the backend pattern described in the SDK's own docs (`docs/02-concepts/02-backends.md`): new backends land later without breaking the action's proto.
<!-- docref: end -->

## Adding a new action type

The shape of the work, if you're working inside this codebase or as a downstream SDK consumer:

<!-- docref: begin src=server:internal/api/action_validators.go:3ac0caa4 -->
1. **Proto** — add the enum value to `ActionType`, define a params message, plug it into the action's params oneof, regenerate (`cd sdk && make generate`).
2. **Server validator** — server-side input checks land in `server/internal/api/action_validators.go`. Most actions only need the proto-level `validate:` tags; cross-field rules live here.
3. **Agent executor** — add the `case` in `executor.go` and the method body. Read current state through SDK primitives; short-circuit when desired == current; emit a structured `CommandOutput`.
4. **Web form** — register the action's form schema and renderer in `web/src/lib/forms/`.
<!-- docref: end -->

The standing rule (see CLAUDE.md): shared utilities go in the SDK first, not in the first consumer. If the executor needs a primitive that doesn't exist yet — say, parsing a new on-disk format — it goes under the SDK's `sys/<thing>` and gets a unit-test suite there, not buried inside `action_xxx.go`.

## What this gives you operationally

- **Idempotency is structural, not aspirational.** The current-state read is in the same method as the desired-state apply.
- **Adding distro support is cheap.** Add a backend to the SDK; every action that uses it gets it.
<!-- docref: begin src=server:internal/eventtypes/types.go#ExecutionCreated:6678853b -->
- **Auditing is uniform.** Every action emits `ExecutionCreated` / `ExecutionCompleted` / `ExecutionFailed` regardless of what it ran, with the same payload shape.
<!-- docref: end -->
- **The agent stays small.** The action surface doesn't grow per backend; the SDK substrate does.
