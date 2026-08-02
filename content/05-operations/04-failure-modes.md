---
title: Failure modes
---
# Failure modes

## Database unavailable

If the SQLite file is unreadable or its schema is not current, control cannot
safely mutate state, audit, dispatch, or search. Readiness fails until the
database recovers. Do not buffer unbounded writes in memory.

## Agent disconnected

Already received schedules continue locally. New deliveries remain pending in
the database and are offered after reconnect.

## Missed dispatcher wakeup

The periodic database sweep discovers pending rows. The in-process signal is
only a latency optimization.

## Crash during a non-idempotent action

The agent's durable `STARTED` record causes an `INDETERMINATE` result. It
does not silently repeat the effect.

## Audit write fails

The associated mutation rolls back. Audit evidence and state cannot diverge.

## Backup destination unavailable

Control remains available, but backup age and replication lag alert. Recovery
point risk grows until replication resumes.

## Control host lost

Restore the database, artifacts, configuration, and keys from the off-host
copy. The design promises a monitored bounded recovery-point window, not zero
loss.
