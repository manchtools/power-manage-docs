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

Control remains available. Once the last verified backup is older than
`POWER_MANAGE_BACKUP_MAX_LAG`, `control backup-status` reports it as stale and
the backup-inspection job records a stale backup posture; when
`POWER_MANAGE_WEBHOOK_URL` is set, that job also emits the backup-lag
notification. Copying backups off-host is operator-owned, so control raises no
signal when that transport stalls. Recovery point risk grows until backups
resume.

## Control host lost

Restore the database, artifacts, configuration, and keys from the off-host
copy. The design promises a monitored bounded recovery-point window, not zero
loss.
