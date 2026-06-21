---
title: Spec template
order: 1
description: The canonical format for feature specifications. Copy this file to start a new spec.
---

# Spec template

Copy this file into the appropriate specs subdirectory and fill in every
section. Delete sections that don't apply — but only after confirming
they genuinely don't. An empty section is a signal that something was
overlooked.

```markdown
---
title: "[Feature name]"
status: draft
created: YYYY-MM-DD
---

# [Feature name]

## Overview

[One paragraph describing the feature: what it does, who uses it, why
it exists. This paragraph becomes the meta description for the spec
page and feeds search indexing.]

## Motivation

[Why this feature is needed now. What problem does it solve? What
can't the user do today that they'll be able to do after? Link to
related issues, ADRs, or previous specs.]

## Acceptance criteria

Numbered, testable statements. Every criterion must be verifiable by
at least one automated test. If a criterion can't be tested, it's a
documentation note, not an acceptance criterion.

1. [Criterion 1 — happy path]
2. [Criterion 2 — edge case]
3. [Criterion 3 — rejection path]
4. ...

Each criterion follows the pattern: "Given [precondition], when
[action], then [observable outcome]."

## Out of scope

[Explicitly list what this spec does NOT cover, especially things that
might seem in-scope to a reader. This prevents scope creep and gives
the agent clear boundaries.]

## Technical design

### Affected packages

- `server/internal/[package]` — [what changes and why]
- `sdk/proto/pm/v1/[file].proto` — [new/changed messages or RPCs]

### Proto changes

[New or changed protobuf messages, enums, RPCs. Include the full
message definition or the delta. Every new field must carry a
`@gotags validate:"..."` tag.]

### Database changes

[New event types, new projection tables, migration notes. Reference
specific migration files if they exist.]

### New dependencies

[Any new Go modules, system libraries, or infrastructure components.
Justify each one — why the standard library or existing dependency
can't solve this.]

## Security considerations

[Threat-model this feature. What could an attacker do? What
authorization gates exist? What input validation is required? What
secrets are handled? Reference the security rules in CLAUDE.md.]

- Authorization: [who can do this? what scopes?]
- Input validation: [what must be validated at the boundary?]
- Secrets: [any keys, tokens, or credentials handled?]
- Audit: [what state-changing operations must be logged?]

## Test requirements

### Handler tests

[For each RPC handler: what request fields get correct/absent/wrong
coverage? What authorization scenarios? What rejection paths?]

### Integration tests

[Tests that span multiple packages or external systems. What real
infrastructure is needed (Postgres, Redis, testcontainers)?]

### Property-based or generative tests

[Any invariants that should hold across random inputs?]

## Rejection paths

Enumerate every way this feature can fail, and what the user sees:

| Scenario | Error code | Client-visible message | Logged context |
|----------|-----------|----------------------|----------------|
| [when X happens] | [InvalidArgument / NotFound / PermissionDenied / …] | [message] | [what gets logged] |

## Rollout and migration

[Any database migrations, config changes, or deployment sequencing?
Does this need a feature flag? Is it backward-compatible?]

## References

- ADR-[NNNN]: [title]
- [Link to related spec or issue]
```
