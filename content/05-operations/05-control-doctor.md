---
title: control doctor
---
# `control doctor`

A standalone, read-only health and security-posture pass over a deployment. It inspects the deploy `.env`, the on-disk certs, and (when reachable) the live Postgres / Valkey state — and never mutates anything.

<!-- docref: begin src=server:cmd/control/main.go#@doctor-subcommand:215d5a9d,server:cmd/control/doctor.go#runDoctor:7091dc81 -->
The subcommand runs *without booting the server* — it intercepts before flag parsing, so it works on a host where the control server can't even start (bad config is exactly when you need it). Run it inside the control container or against the deploy directory:

```bash
docker compose exec control control doctor
# or, on the deploy host with the binary available:
control doctor --env-file deploy/.env
control doctor --json          # machine-readable, for CI / monitoring
```

`--env-file` (default `.env`) merges the deploy env file over the process environment — the file wins, since it's the operator's stored source of truth. The whole pass runs under a 15-second timeout.
<!-- docref: end -->

## Exit codes

<!-- docref: begin src=server:internal/doctor/doctor.go#Report.ExitCode:91e925ce -->
The exit code is graduated so scripts and CI can gate on it:

| Exit | Meaning |
|---|---|
| `0` | Healthy — only OK / info findings |
| `1` | At least one **warning** |
| `100` | At least one **critical** finding |
| `2` | A check **could not run** at all (highest precedence — the report is incomplete, fix the doctor invocation/config first) |
<!-- docref: end -->

```go docref=server:internal/doctor/doctor.go#Report.ExitCode:91e925ce
func (r Report) ExitCode() int {
	if len(r.ExecErrors) > 0 {
		return 2
	}
	switch r.Worst() {
	case SeverityCritical:
		return 100
	case SeverityWarning:
		return 1
	default:
		return 0
	}
}
```

<!-- docref: begin src=server:internal/doctor/doctor.go#Run:76531206 -->
A panicking check never aborts the suite — it's recovered into a "could not run" execution error (exit 2), distinct from a check that ran and found a problem: a down datastore is a *critical finding*, not an exec error.
<!-- docref: end -->

## What it checks

<!-- docref: begin src=server:internal/doctor/registry.go#DefaultChecks:650fcb22 -->
| Check | Looks at |
|---|---|
| `secrets` | Weak or placeholder secrets in the env (short JWT secret, default passwords) |
| `encryption_key` | `CONTROL_ENCRYPTION_KEY` present and well-formed — at-rest encryption is mandatory |
| `cors` | Credentialed wildcard CORS origin |
| `ports` | Internal mTLS listener bound to all interfaces |
| `image_tag` | Floating `IMAGE_TAG` (e.g. `latest`) in a production deploy |
| `cert_perms` | Private key files group/world-readable |
| `cert_expiry` | CA / service certs missing, expired, not yet valid, or near end of life |
| `datastores` | Postgres + Valkey reachability |
| `queues` | Asynq dead-letter (archived) queue depth |
| `search` | Expected search indexes present, indexer alive |
| `terminal` | Valkey keyspace notifications + Traefik terminal-routing config (the silent terminal-404 trap) |
| `admin` | Bootstrap admin still on the default email |
<!-- docref: end -->

<!-- docref: begin src=server:internal/doctor/doctor.go#Finding:0281b8e2 -->
Each finding carries an ID, a severity (`ok` / `info` / `warning` / `critical`), a message, and — for warnings and criticals — a remediation hint. Findings never contain secret *values*: they name the variable or file and describe the shape of the problem only.
<!-- docref: end -->

## The cert-expiry horizon is lifetime-relative

<!-- docref: begin src=server:internal/doctor/check_certs.go#CertExpiryCheck:f322a1fd,server:internal/doctor/check_certs.go#remainingFraction:2c1eb91e -->
`cert_expiry` doesn't use a fixed "30 days left" threshold. The warning horizon is derived from each cert's **own lifetime**: past 80% of its validity window (under 20% remaining) is a warning, mirroring the agents' 80%-lifetime auto-renewal — if a cert is past that point, auto-rotation should already have fired, so a warning here means the rotation machinery needs attention. Missing, unparseable, expired, or not-yet-valid certs are critical.
<!-- docref: end -->

<!-- docref: begin src=server:internal/doctor/check_certs.go#CertPermsCheck:233168d8 -->
`cert_perms` fails **closed**: a configured private key it cannot stat is a critical finding ("cannot verify a security-relevant file"), never a silent skip. Keys that are group- or world-accessible are critical too — the remediation is `chmod 0400`.
<!-- docref: end -->

## When to run it

- After every deploy or `.env` change — gate the pipeline on exit code `0`.
- On a schedule (cron + `--json` into your monitoring) to catch cert drift and dead-letter buildup.
- First thing when "something is off" — it encodes the known silent-failure traps (terminal routing, keyspace notifications, floating image tags) so you don't rediscover them from scratch. For symptom-driven digging, see [Troubleshooting](/operations/troubleshooting).
