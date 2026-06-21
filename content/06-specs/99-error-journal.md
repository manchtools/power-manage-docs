---
title: "Error journal"
status: live
order: 99
description: Append-only record of systematic errors and the Harness fixes that prevent recurrence. Every entry must have a corresponding rule update in a CLAUDE.md or skill file.
---

# Error journal

This is an append-only record. Each entry captures a systematic error,
its root cause, and the Harness fix that prevents recurrence. The error
journal is part of Harness Correction Development — when the agent makes
a mistake, fix the rules, not just the output.

## Format

```markdown
## [YYYY-MM-DD] [Error class] Brief description

**What happened**: [One sentence]

**Root cause**: [Why the Harness didn't prevent this]

**Harness fix**: [What file was updated and how]

**Prevention**: [How the updated rule prevents recurrence]
```

## Entries

<!-- Entries are appended below this line. Never delete entries. -->
