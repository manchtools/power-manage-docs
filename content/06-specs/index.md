---
title: Specifications
icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='2' y='3' width='20' height='14' rx='2' ry='2'/><line x1='8' y1='21' x2='16' y2='21'/><line x1='12' y1='17' x2='12' y2='21'/></svg>"
---

# Specifications

Every feature starts as a spec. The spec is the source of truth: tests
derive from acceptance criteria, implementation derives from tests.

- [**Spec template**](/specs/spec-template) — the canonical format. Copy
  this to start a new feature spec.
- [**Example spec**](/specs/example-spec) — a filled-in template for a
  real feature, showing what complete looks like.

## How specs drive development

1. **Discuss** — you and the agent discuss the feature. The agent asks
   clarifying questions until the design is unambiguous.
2. **Write** — the agent drafts the spec in the template format. You
   review and approve it.
3. **Test** — the agent writes tests that encode every acceptance
   criterion. Tests must fail before implementation exists.
4. **Implement** — the agent writes the implementation. Tests pass.
5. **Verify** — the agent runs the verification gate. All checks green.
6. **Document** — any architectural decisions from the spec become ADRs.
   Public-facing changes update the docs.

A spec is **done** when every acceptance criterion has a passing test,
the verification gate is green, and any docref-marked code that changed
has been re-approved.
