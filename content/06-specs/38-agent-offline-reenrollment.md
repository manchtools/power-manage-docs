---
title: "Agent offline reenrollment"
status: draft
created: 2026-07-16
---

# Agent offline reenrollment

## Overview

Add an explicit root-only, offline `power-manage-agent reenroll` operation for
replacing an installed agent's management identity after a hard control-plane or
CA replacement. The daemon and command share one process-lifetime credential
lock rooted in the configured data directory. Reenrollment validates the
incumbent through fd-anchored no-follow file access, performs exactly one bounded
non-idempotent registration attempt while the incumbent remains active, validates
the complete candidate, verifies durable rollback material, commits the candidate
through one atomic rename without changing the active salt, and retires the old
management identity's scheduler/result state before the candidate can run.

## Motivation

Re-running `install.sh` with a new server/token currently preserves the existing
credentials, the daemon does not expose `enroll.sock`, and the installer can
misleadingly report the old identity as enrolled. The normal enrollment handler
also treats valid existing credentials as a no-op and can fall through to new
registration when an existing credential file cannot be loaded. Same-CA
certificate renewal deliberately cannot replace an unrelated trust anchor.
Operators therefore have no supported, crash-consistent way to move an installed
agent to a replacement control plane.

Registration is not an idempotent operation. Today Control commits token
consumption and device registration separately, so an explicit server error can
arrive after the token has been consumed; its retrying event append also does not
serialize concurrent one-time/max-use admission. This spec makes those two events
one token-serialized atomic batch, but a lost response or post-response local
failure can still leave an orphan remote identity. Reenrollment therefore
preserves the known-working local identity on every pre-commit failure and never
hides possible or confirmed remote side effects behind an automatic retry.

## Acceptance criteria

1. Given valid existing credentials, no retained backup or reenrollment attempt, and a
   stopped daemon, when root runs `reenroll` with the installed data directory,
   valid HTTPS Control URL, and protected token file, then exactly one SDK
   registration invocation is made with no application-level retry or redirect,
   the candidate is fully validated and differs from the incumbent ULID, the
   incumbent is backed up, the
   candidate is atomically committed, the local management-state binding is
   transitioned from the old to the new device ULID, and the command reports both
   ULIDs.
2. Given a custom installed `--data-dir`, then the credential lock, canonical
   credential/salt files, SQLite store, temporary files, and backups all derive
   from that directory. An explicit CLI value is authoritative; the environment is
   consulted only when the flag was not supplied, and the generated systemd unit
   carries one matching authority rather than conflicting flag/environment values.
   No reenrollment path silently falls back to `/var/lib/power-manage` after
   configuration is resolved.
3. Given a non-root caller or a lock held by the daemon/another writer, when the
   command is invoked, then it rejects before opening the token file or making a
   network request.
4. Given ordinary daemon startup, when it begins credential inspection, then it
   opens the configured data directory without following symlinks, acquires an
   exclusive advisory lock on `<data-dir>/credentials.lock`, and holds the
   descriptor for the process lifetime; certificate rotation and all in-daemon
   credential writes occur under that lease. The updater's pre-shutdown candidate
   self-test receives a parent-created sealed read-only credential snapshot through
   an anonymous child fd while the parent retains the lease; it never reopens
   credential paths or acquires/inherits the lock. Standalone self-test acquires the
   ordinary lease before inspection.
5. Given preflight examines the data directory, token path, lock, canonical pair,
   or backups, then every absolute path component is walked from `/` with
   directory-fd-relative `O_NOFOLLOW|O_DIRECTORY|O_CLOEXEC`; named entries use
   `O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC` before `fstat`. Exact regular-file/directory
   type, root ownership, and modes are verified before network effects. Ancestor
   or final symlinks, FIFOs/sockets/devices, wrong metadata, replacement races, or
   I/O errors fail closed without blocking.
6. Given canonical credentials, salt, `credentials.enc.next`, retained backups,
   the durable reenrollment-attempt row, and either the entire agent database or
   every management binding/identity-bound row and setting are all truly absent,
   when `reenroll` is invoked, then it directs the operator to ordinary enrollment.
   Stat, permission, I/O, decrypt, parse, salt, or identity errors are not
   classified as unenrolled.
7. Given valid local inputs, the durable transition to attempt state `invoking`
   is the conservative remote-side-effect boundary. It then makes one
   `sdk.RegisterAgent` invocation under a 45-second deadline, rejects every
   redirect on the final client, and performs no application-level retry. An
   arbitrary caller transport may perform protocol-level replay that the SDK
   cannot suppress; the contract never claims one wire write. Any failure, signal,
   or crash after the `invoking` commit is `remote unknown`; a returned success
   followed by local candidate/commit rejection is
   `remote registration confirmed`. The current SDK does not claim byte-level
   proof that a failed request never reached Control.
8. Given registration returns a candidate, then exactly one CA `CERTIFICATE` PEM
   block with no extra block/garbage is parsed, pinned, and used as the sole root.
   The leaf has the returned ULID in CN/subject serial, exact agent URI SAN and
   ClientAuth-only EKU sets, no DNS/IP/email SAN, `IsCA=false`, exact production
   key usage, matching local key, and a current-time-valid chain to that CA.
   Canonical Control/Gateway HTTPS base URLs and the optional CA pin also pass.
9. Given any registration/validation/local-persistence failure before the active
   rename, then `credentials.enc` and `salt` remain byte-for-byte unchanged. The
   result separately reports: no remote call, remote outcome unknown, or confirmed
   remote registration requiring cleanup. It also reports whether the incumbent
   is structurally restart-safe; neither remote-side-effect class recommends retry.
10. Given candidate validation succeeds, when local replacement begins, then the
    active `salt` is re-read through the anchored descriptor, must equal preflight
    bytes, and remains byte-for-byte unchanged. Reenrollment never rotates salt.
11. Given local replacement begins, then the encrypted candidate is first
    durably published and reopened as root-owned mode-`0600`
    `credentials.enc.next`. Complete incumbent rollback material is then created
    no-replace as `credentials.enc.bak` and `salt.bak`; candidate and backups are
    verified for exact bytes/identity, regular-file type, root ownership, and mode
    before active publication.
12. Given a verified staged candidate and verified complete backups, then exactly
    one atomic rename of `credentials.enc.next` over `credentials.enc` is the
    active commit point. Directory fsync/open/close failures propagate; no
    candidate becomes canonical before backup verification succeeds.
13. Given a process crash before the active rename, then canonical incumbent and
    its management-state binding remain authoritative while the durable attempt
    row, staged candidate, and partial/complete backups classify the exact resume
    or abort path. Given a crash after the active rename but before local state
    rebinding, then startup recognizes the exact canonical-candidate/
    backup-incumbent/bound-old-ULID tuple and completes the idempotent retirement
    transaction before runtime starts.
    No crash point exposes a new salt with old ciphertext, old salt with new
    ciphertext, or old-identity scheduler/results state to the new identity.
14. Given an error after the active rename during directory durability or
    post-commit reload validation, then the command attempts anchored atomic
    restore from the verified backup. It reports either confirmed incumbent
    restoration or a critical ambiguous-local-state outcome; it never falsely
    claims the old identity is active.
15. Given successful replacement, then the command reloads/revalidates the
    canonical candidate, re-verifies backup bytes/metadata, and retains backup
    until explicit root cleanup. It does not automatically delete the old remote
    device. Backup cleanup is allowed only after hardened `DeleteDevice` records
    deletion after processing every certificate issued to the old device. Mandatory
    real-handler/Postgres tests use injected clocks and authoritative event fixtures
    to cover current, expired, not-yet-valid, and legacy missing-`NotBefore`
    histories. Deployment E2E separately proves CRL HTTP rejection for a newly
    issued still-valid old certificate through the public route and every Gateway
    replica; synthetic certificate-time branches never substitute for that
    middleware proof.
16. Given startup finds a valid canonical identity plus a correlated
    reenrollment attempt state (`prepared`, `invoking`, `returned`, or `staged`),
    then that canonical identity remains the only runtime identity when the SQLite
    binding matches it; every attempt state blocks registration and every credential
    writer, including certificate rotation, so incumbent ciphertext and attempt
    hashes cannot drift before root performs the state-specific resume or abort.
    Management runtime may continue with credential state read-only and an explicit
    recovery warning. A retained committed-replacement backup without an attempt row
    does not itself disable credential writers when canonical credentials and the
    SQLite binding agree. Given canonical credentials are absent/invalid while an
    attempt or backup artifact exists, then startup fails closed, does not open the
    mode-`0666` enrollment socket, and never automatically rolls back or retries a
    network operation.
17. Given any ordinary registration entry point—daemon flag/environment startup
    or local-socket enrollment—sees credential state other than confirmed absence,
    then the classified error is returned and no registration/replacement call
    occurs. Bool-only `Store.Exists()` is not a security decision anywhere.
18. Given the command exits, then one exact machine class distinguishes success
    (`0`), usage syntax (`2`), no remote call with restart-safe incumbent (`10`),
    remote outcome unknown with restart-safe incumbent (`11`), ambiguous local
    canonical state (`12`), confirmed remote registration with restart-safe
    incumbent (`13`), and no remote call but no restart-safe incumbent (`14`; the
    `cleanup-backup` subcommand reuses `14` for unmet cleanup preconditions with
    backups retained). Installer behavior uses only these classes, never human text.
19. Given normal `install.sh` receives a token, then after syntax validation it
    records service activity, stops a previously active daemon, runs fd-anchored
    upgrade preparation plus root-only `credential-status` against the exact
    configured data directory, and acts only on its machine class. A startable
    canonical identity is restarted unchanged and reports the token unused;
    confirmed absence proceeds to ordinary enrollment; any correlated interrupted
    attempt or invalid/indeterminate state performs no registration and follows its
    specified safe restart/stop result. Explicit `--reenroll` first completes that same ordinary
    upgrade/migration phase when the installed state predates this spec, but the
    strict reenrollment command never calls path-based `create_directories` or
    repairs metadata. It requires `--token-file`, forwards the one resolved
    `--data-dir`, starts the candidate on `0`, restarts the incumbent only on
    `10`/`11`/`13`, and leaves stopped on `12`/`14` or unclassified interruption.
    Class `2` is handled before stop.
20. Given the compatible agent artifact registers capability
    `offline-reenrollment-v1` together with complete scenarios, then spec 37 observes
    that readiness and makes the stable `agent-reenrollment` lane blocking. The lane
    exercises lock rejection, ancestor/final no-follow and nonblocking type failures,
    redirect refusal, remote/local classes, failed preservation, new-identity
    connection, retained rollback material, staged resume/abort, authoritative
    old-device deletion, mandatory TLS-valid public/per-replica CRL middleware proof,
    and backup cleanup through production binaries and the real network/filesystem.
    Certificate-time branches not producible through public issuance remain mandatory
    real-handler/Postgres tests with injected clocks and authority fixtures. Source
    selectors schedule this already-ready lane but never declare readiness; ordinary
    install/status/non-replacement scenarios remain owned by `agent-socket`.
21. Given an upgrade from a previously accepted installation (`0755`/`0750`
    directory or permissive/non-root credential metadata), then ordinary upgrade
    preflight uses no-follow descriptors and `fchmod`/`fchown` only on verified
    regular paths before service start. Symlink/non-regular paths are never
    repaired. The explicit reenrollment branch performs no repair and observes the
    existing state unchanged.
22. Given any device-targeted mutation whose eligibility depends on a live device,
    then it acquires one shared per-device lifecycle advisory lock before any queue,
    token, secret, session, persistence, or event effect; replays authoritative
    lifecycle state; and rejects after `DeviceDeleted`. Registration and renewal
    derive fingerprint plus second-precision `NotBefore`/`NotAfter` from the emitted
    DER and persist them in immutable authority events; deletion never trusts the
    fallible device projection. Retention preserves the exact lifecycle authority
    event set and a transactional stream head/version, so pruning unrelated events
    cannot erase identity/certificate history or reuse a version. `DeleteDevice`
    first appends an immutable deletion-requested audit event, then processes every
    issued certificate under exact current/not-yet-valid/expired/legacy-time
    branches, and appends `DeviceDeleted` only after all mandatory CRL writes
    succeed. A certless device is deletable only when replay proves no certificate
    was ever issued; partial/corrupt metadata fails opaque `Internal`. Revocation or
    final append failure leaves a retryable non-deleted stream with durable attempt
    evidence.
23. Given a populated agent store bound to the old device ULID, when reenrollment
    commits the candidate, then one SQLite transaction deletes every
    server-authored scheduler/action/work/result row, maintenance window, and
    persisted LPS public key classified as management-identity-bound,
    then updates the binding to the new ULID. It preserves explicitly classified
    machine-local LUKS/LPS history and local-admin settings, executes no cleanup,
    and a self-discovering exact registry with a matches-zero guard prevents a new
    table or setting key from bypassing classification. Runtime sends or dispatches
    nothing until the binding equals canonical credentials.
24. Given a crash after successful registration but before the active credential
    rename, then the exact journal/file tuple determines recovery. `returned`
    without a verified `credentials.enc.next` cannot resume and requires confirmed-
    remote abort/cleanup; a durable verified next plus any partial/complete backup
    state is `staged`, not corrupt, and may resume without another network call or
    explicitly abort. Either operation proves canonical incumbent bytes, salt, and
    store binding unchanged, is lease-held/fd-anchored/durable, and reports the
    candidate ULID when known.
25. Given ordinary installation needs to decide whether a token is usable, then a
    root-only offline `credential-status` command acquires the configured-directory
    lease and returns machine classes for startable canonical identity, confirmed
    absence, every correlated interrupted attempt, and invalid/indeterminate state.
    The installer stops a previously active service before invoking it and initiates
    first enrollment only for confirmed absence; it reports "token unused" only
    for a startable canonical identity with no attempt state. A fully verified
    committed-replacement backup does not make that identity unstartable.
26. Given reenrollment constructs `RegisterRequest`, then hostname, agent version,
    token, and CSR all pass their exact generated and semantic constraints before
    the remote boundary; raw or rejected URLs are never logged. `RegisterAgent`
    enforces a 256 KiB decompressed registration-response limit through Connect's
    read limit before candidate validation. Any oversized response after the
    `invoking` boundary is remote outcome unknown and leaves the incumbent unchanged.
27. Given concurrent schema-valid registration requests using one one-time or
    max-use token, then Control serializes every post-creation token mutation by
    token, replays retention-preserved authoritative token events under that lock,
    and atomically appends an irreversible `TokenConsumed` plus `DeviceRegistered`.
    `TokenEnabled` can reverse an administrative disable but never consumption;
    malformed or ambiguous history fails opaque `Internal`. Exactly the allowed
    number succeeds even when projections are stale or unrelated events were
    pruned; failed batches commit neither stream. Real-handler/Postgres tests prove
    concurrency, projection-failure, retention, and insert-failure paths.
28. Given first enrollment has durably published valid canonical credentials but
    crashes before creating the SQLite binding, then startup completes only the
    provable first-enrollment tuple under the lease before runtime. A pre-existing
    database is adoptable only from the binding migration's explicit one-shot
    `pending_adoption` marker; a migrated database with no row, existing attempt,
    next-file, or backup evidence, or any unexplained binding state fails closed. Socket
    and flag enrollment never reinterpret these states as absence.
29. Given an incumbent URL accepted by a previous release but not by the new exact
    parser, then ordinary upgrade/startup may preserve it under a read-only legacy
    compatibility parser that matches the previous runtime contract. It is never
    normalized, rewritten, used as a new candidate value, or logged raw. Every new
    Control/Gateway URL written by enrollment, reenrollment, or later credential
    mutation must pass the exact parser.
30. Given any credential reader/writer or enrollment decision, then it uses the
    anchored lease-aware store and exact classifier. The current path-based
    `Load`/`Save` and bool-only `Exists` contracts are not security fallbacks; a
    self-discovering call-site guard covers daemon startup, socket/flag enrollment,
    rotation, self-test/updater, status, reenrollment, and future credential paths,
    with explicit matches-zero failure.
31. Given root invokes `reenroll cleanup-backup` after the candidate has recorded a
    successful connection, then the command requires the exact old ULID plus an
    explicit acknowledgement that an administrator's hardened `DeleteDevice`
    succeeded, validates the retained backup certificate, and removes backups only
    under the lease with durable fd-anchored operations. Fleet-wide CRL enforcement
    and historical-certificate membership are release/deployment evidence, not
    unverifiable per-host live-probe prerequisites; missing proof or mismatch leaves
    every backup intact.
32. Given the server authority model is activated, then no old Control replica may
    serve registration, renewal, deletion, or another guarded device/token writer.
    Rollout preserves the existing renewal lock namespace, transactionally installs
    retention-safe stream heads, and scans existing histories for malformed token
    events or post-delete device events before traffic resumes. Unreconciled history
    fails activation rather than being silently accepted.

## Out of scope

- Live identity replacement while the daemon, gateway stream, or certificate
  rotation is running.
- Treating a registration token alone as authorization to replace credentials
  through the intentionally mode-`0666` enrollment socket.
- Retrying or recovering an ambiguous registration through a new idempotency
  protocol. Registration remains single-attempt under this specification.
- In-place mutation of the old remote device identity. Reenrollment creates a new
  remote device.
- Automatically revoking/deleting the old remote device before the new identity
  is verified online.
- Replacing the normal same-CA certificate-renewal path.
- Rotating the credential salt. A future salt rotation would require a
  generation-directory format with one atomic active-pointer switch, not two
  fixed-path renames.
- Automatically promoting backup files during startup.
- Re-attributing old-device actions, work, or results to the new device identity.
  Reenrollment retires that management namespace; it does not migrate or replay it.

## Technical design

### Affected repositories and order

1. **sdk** — add component-walk/no-symlink path opening and a dirfd-relative
   atomic write/rename primitive; add a canonical HTTPS base-URL parser; enforce
   redirect refusal plus a 256 KiB Connect read limit on the final
   `RegisterAgent` client only.
2. **server** — serialize authoritative token admission and atomically append
   token/device registration events; add authoritative device-lifecycle replay,
   one shared lifecycle lock for post-registration device-stream writers, a
   deletion-requested audit event, and certificate-time-aware revoke-before-delete.
3. **agent** — configured-data-directory lifetime lease, anchored classified
   credential state at every registration entry point, management-identity-bound
   SQLite state and retirement, backup-aware replacement, exact
   incumbent/candidate validation, CLI/exit contract, installer wiring, metadata
   upgrade, startup fail-closed behavior, and real-agent E2E.
4. **docs** — installation, hard-CA replacement, remote-side-effect, rollback,
   old-device revocation, and backup cleanup procedures.

No protobuf change is required. The existing public `Register` RPC is invoked
exactly once. Spec 37's core harness, reviewed three-key manifest, stable
lane/readiness registry, and already-active `agent-socket` baseline land first;
this spec supplies the credential-state fix and separate root-only lane. The
SDK/server/agent candidates are tested as one immutable spec-37 change set. The
agent artifact registers `offline-reenrollment-v1` only together with complete
`agent-reenrollment` scenarios, and no member is released before the resulting
manifest-triggered gate is green.

### Command and local input rules

Add:

```text
power-manage-agent reenroll \
  -server=https://control.example.com \
  -token-file=/root/power-manage-registration-token \
  [-data-dir=/var/lib/power-manage] \
  [-ca-sha256=64_HEX_CHARACTERS]
```

Recovery and cleanup are explicit root-only forms:

```text
power-manage-agent reenroll recover --resume -data-dir=PATH
power-manage-agent reenroll recover --abort -data-dir=PATH \
  [--acknowledge-remote-unknown | --acknowledge-remote-registration-confirmed]
power-manage-agent reenroll cleanup-backup -data-dir=PATH \
  --old-device-id=ULID --acknowledge-delete-device-success
```

`--resume` and `--abort` are mutually exclusive. `prepared` abort needs no remote
acknowledgement and returns class `10`; `invoking` abort requires the unknown flag
and returns `11`; `returned`/`staged` abort require the confirmed flag and return
`13`. Resume is valid only for `staged` and returns `0` after the candidate becomes
canonical. Syntax/acknowledgement mismatch is `2`; a state mismatch returns the
persisted remote class when local incumbent safety is proved, otherwise `12`/`14`.
Cleanup success returns `0`; missing candidate-connection evidence, ULID/deletion
acknowledgement mismatch, or incomplete backup proof returns `14` without removal.

`-data-dir` defaults to `credentials.DefaultDataDir` and must be an absolute,
clean non-root path: no trailing/repeated separator or `.`/`..` component. Flag
resolution records whether the operator supplied it: an explicit CLI value wins;
`POWER_MANAGE_DATA_DIR` is consulted only when the flag is absent. The packaged
systemd unit uses the resolved `--data-dir` flag as its single authority and does
not also set a competing environment value. The installer resolves once, writes
that unit value, and forwards the same value to preparation, status, and reenroll.
The agent binary's own flags are parsed by Go's `flag` package, so single- and
double-dash spellings (`-data-dir`/`--data-dir`) are equivalent throughout; the
`install.sh` options use the double-dash form. The exact contract is the option
name, not its dash count.
A shared SDK opener supplies mechanism only: it validates component grammar, walks
every component from `/` using `O_NOFOLLOW|O_DIRECTORY|O_CLOEXEC`, retains the
final descriptor, and returns descriptor/stat metadata. The agent policy layer
requires each ancestor (including `/`) to be a UID-0 directory with no group/world
write bits and the final directory to be exact UID 0/mode `0700`. Every credential, lock,
temporary, and backup name is
a single-component operation relative to that descriptor. A custom installation
must pass the same configured directory; the installer always forwards its
resolved `--data-dir`.

The command does not accept a plaintext token argument. `-token-file` must be an
absolute clean path with the same component restrictions and no-follow walk. Its
final component
is opened `O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC` before `fstat` and must be a
UID-0 mode-`0600` regular file of at most 4096 bytes. FIFO/socket/device inputs
therefore reject without hanging. After trimming surrounding ASCII whitespace,
token content must be 1–255 bytes, matching `RegisterRequest`. It is opened only
after effective-UID, data-directory, credential-state, and lock checks. This path
does not reuse the current blocking, symlink-following, unbounded
`resolveEnrollToken`; the installer recognizes `--reenroll`/`--token-file` before
its unconditional shell `create_directories` path and passes the file through
without reading or copying its secret. The optional pin is exactly one
64-hex-character SHA-256 digest; comparison is over the DER of the sole parsed CA
certificate. Proto `max` constraints count string characters, so the token's
1–255-byte ASCII/no-control bound is an additional stricter local rule, not a claim
about generated byte semantics. Hostname is exact valid UTF-8, 1–253 characters,
with no leading/trailing whitespace, NUL, or control character. Agent version is
1–32 ASCII characters matching `[0-9A-Za-z][0-9A-Za-z._+-]*`. The CSR is exactly one
`CERTIFICATE REQUEST` PEM block with no trailing data, a valid signature, P-256
public key matching the generated private key, subject containing only CN equal to
the hostname, and no SAN or other requested extension. The request-taking builder
validates the final proto instance that `RegisterAgent` sends so preflight cannot
check a different object.

Add one SDK base-URL parser that returns the exact accepted value. Its grammar is
`https://<hostname-or-IP>[:port]` with a non-empty `Hostname()`, valid optional
port 1–65535, and no surrounding whitespace, userinfo, path/trailing slash,
query/forced query, fragment, opaque form, or non-HTTPS/case-variant scheme. The
input Control URL and returned Gateway URL both pass this parser before storage;
renewal and CRL retrieval use those exact stored strings. A port-only authority
such as `https://:443` is invalid.

The command creates a 45-second context around the single `RegisterAgent`
invocation. All local validation completes first; the durable `invoking` journal
commit is the conservative remote-side-effect boundary. After caller options have
selected the final HTTP client, `RegisterAgent` copies/wraps that client, leaves the
caller-owned `Transport`, `Timeout`, `Jar`, and redirect policy unchanged,
unconditionally installs a reject-all redirect policy on the copy, and adds
Connect's 256 KiB decompressed read limit. These registration-only invariants cannot
be replaced by an option and do not change shared renewal/CRL behavior. There is no
SDK/application retry. A caller transport may perform protocol-safe replay, so the
contract is one invocation rather than one provable wire write. Control's current
30-second RPC deadline may end before the 45-second client bound. After the
`invoking` commit the client deliberately treats cancellation, call construction,
and even a server error currently known to precede the handler as remote-outcome-
unknown; recovery safety does not depend on an evolving server error taxonomy.

Stable exit classes are the complete machine contract:

- `0` — candidate is canonical, reload-validated, and active;
- `2` — command-line grammar/required-argument syntax is invalid, before service
  stop or state/network claims;
- `10` — no registration call occurred and the incumbent is structurally
  restart-safe;
- `11` — the durable remote-side-effect boundary was crossed, its remote outcome
  is unknown, and the incumbent is structurally restart-safe;
- `12` — canonical local identity is ambiguous or cannot be proved restart-safe;
- `13` — registration returned success, later validation/persistence failed, and
  the incumbent is structurally restart-safe; remote cleanup is required;
- `14` — no registration call occurred and no restart-safe incumbent can be
  proved, including failure before the command can inspect it safely; for the
  `cleanup-backup` subcommand `14` instead denotes unmet cleanup preconditions,
  so backups are retained and the already-canonical candidate is untouched.

Classes `11` and `13` never recommend automatic retry. Human-readable errors
explain stage and recovery, but installer control flow uses only these numbers.

### Credential lifetime lock

Use `<data-dir>/credentials.lock`. Every consumer opens the configured
directory through the component-walk helper and retains that descriptor. Only
ordinary metadata preparation and fresh daemon startup may create the absent
single-component lock with
`O_RDWR|O_CREAT|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC`, creation mode `0600`. Strict
`reenroll`, recovery, backup cleanup, standalone self-test, and
`credential-status` open an existing lock without `O_CREAT`; absence is a
classified preflight failure rather than a side effect. Every path then `fstat`s
a UID-0 mode-`0600` regular file; a symlink or blocking/nonregular object is
rejected.

The daemon acquires an exclusive advisory `flock` before its first credential
classification and holds the lock descriptor until process exit. An unenrolled
daemon also holds the lease while serving ordinary enrollment, so all in-process
saves and certificate rotation occur under the same lifetime critical section.
The updater preserves its current pre-shutdown validation order while the parent
retains the lease. It classifies credentials itself, serializes only the validated
fields required by self-test into an anonymous `memfd`, seals it against write/
grow/shrink, and passes that read-only fd only to the signature-verified candidate
through the explicit child-fd mapping. The candidate verifies the seals, reads the
bounded snapshot, and never opens the data directory or acquires/inherits the lock;
the lock and directory descriptors remain close-on-exec. A directly invoked
self-test follows the normal lease acquisition path and rejects while the daemon
owns it. The snapshot fd is closed in parent and child on every path and is never
persisted or logged.

`reenroll` attempts the same lease nonblockingly before token access or network
effects. If it cannot acquire the lease, it cannot safely inspect the incumbent
and returns class `14`, not a local-safe claim. A reenrollment-only lock or a
hardcoded default-directory lock is insufficient.

### Credential-state classification

Replace bool-only `Store.Exists()` security decisions with one anchored
classifier used by daemon flag/environment startup, local-socket enrollment,
certificate writers, and reenrollment. It distinguishes:

- confirmed absence: canonical credentials, salt, `credentials.enc.next`, both
  backups, and the SQLite attempt row are all absent by successful anchored lookup,
  and either the entire agent database is absent or read-only inspection proves no
  binding and no management-identity-bound rows/settings;
- valid canonical credential pair, with staged candidate, attempt row, and backup
  absence/presence reported separately;
- inaccessible or indeterminate lookup/read state;
- present but nonregular, wrong-owner, wrong-mode, oversized, corrupt,
  undecryptable, or unparseable canonical credentials;
- missing, nonregular, wrong-owner/mode, wrong-length, changed, or unreadable
  salt;
- partial, invalid, or complete staged candidate/attempt/backup state.

Only confirmed absence permits ordinary first enrollment. A new reenrollment
attempt requires a structurally valid canonical pair and complete attempt/backup
absence; recovery consumes only the exact correlated attempt state. Each named entry
is opened relative to the retained directory descriptor with
`O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC`, then checked by `fstat` before reading. Exact
requirements are UID 0/mode `0600`, regular-file type, credential ciphertext
size 1–1,048,576 bytes, and the existing exact 32-byte salt. No path-based
`os.Stat`/`os.ReadFile` participates in the decision. Presence, permission, I/O,
decrypt, parse, salt, or backup uncertainty is never converted to absence.
Startup with backup material and invalid/absent canonical state fails closed and
does not expose the enrollment socket.

The existing path-based credential `Load`/`Save` and bool-only `Exists` APIs are
retired from production security decisions rather than wrapped underneath the new
classifier. Anchored equivalents cover canonical load/save, first enrollment,
rotation, updater/self-test, socket status/enrollment, reenrollment, recovery, and
installer status. A self-discovering source guard discovers credential-file readers,
writers, and registration decisions, requires the lease-aware surface, fails on
zero matches, and keeps test/migration exceptions explicit.

### Candidate registration and validation

While holding the lock:

1. Classify and decrypt the incumbent through anchored descriptors. Structural
   restart safety requires valid credential JSON; valid old device ULID; exact
   one-block CA and leaf PEM parsing; CA/leaf signatures and issuer relationship;
   agent leaf identity/SAN/EKU/key-usage profile; private-key match; and stored
   endpoint strings accepted either by the exact parser or the read-only legacy
   compatibility parser that reproduces the previous runtime's HTTPS/host checks.
   A missing `ControlAddr` remains a supported legacy restart-safe state and
   continues to mean certificate rotation is unavailable. Legacy endpoint strings
   are neither normalized nor rewritten; all candidate strings use the exact
   parser. Certificate time validity is reported separately and is
   not part of restart safety: an expired or
   not-yet-valid but otherwise intact incumbent may be restarted, though it may
   not connect. This distinction prevents a clock/certificate condition from
   being mislabeled as local corruption.
2. Read/hash raw incumbent `credentials.enc` and `salt`; record old device ULID,
   certificate fingerprint, structural status, and current-time connectivity
   status without logging certificate material. Open the agent store while the
   daemon is stopped and require its management-device binding to equal that old
   ULID before token or network access; a missing one-time-upgrade binding is
   adopted only under the migration rule below.
3. Validate token file, Control URL, optional CA pin, hostname, agent version,
   and every generated `RegisterRequest` constraint. Generate a private key and
   CSR in memory, then parse and verify the CSR signature, public-key match, and
   exact semantic profile before any remote boundary.
4. Insert the safe SQLite attempt row in `prepared` state. Immediately before the
   call, durably advance it to `invoking`, mark the conservative remote boundary,
   and invoke `sdk.RegisterAgent` exactly once under the 45-second deadline.
5. On a returned success, durably advance the attempt to `returned` (recording a
   candidate ULID only when structurally valid), mark remote registration
   confirmed, then validate every required response field/device ULID and require
   the candidate ULID to differ from the incumbent before candidate persistence.
6. Decode the CA as exactly one PEM block whose type is `CERTIFICATE`; reject an
   extra block or any trailing non-whitespace. Parse that DER, require
   `BasicConstraintsValid`, `IsCA`, and `KeyUsageCertSign`, compare the optional
   pin to SHA-256 of that DER, and place only this certificate in a fresh root
   pool.
7. Decode the leaf as exactly one `CERTIFICATE` block with no extra block or
   trailing non-whitespace and require: returned ULID equals
   `Subject.CommonName` and `Subject.SerialNumber`; URI SAN set is exactly
   `spiffe://power-manage/agent`; DNS/IP/email SAN sets are empty; EKU set is
   exactly `ClientAuth`; `IsCA` is false; key usage is exactly
   `DigitalSignature|KeyEncipherment`; public key matches the generated private
   key; and current-time chain verification succeeds against only the parsed CA.
8. Parse the exact input Control URL and returned Gateway URL with the new base-URL
   parser and persist the returned strings, not trimmed or reconstructed variants.
9. Construct complete candidate credentials in memory without touching canonical
   or backup paths.

No token, private key, certificate plaintext, credential ciphertext, CSR,
challenge, raw URL, or rejected URL component is logged. Every registration entry
point validates before logging and emits only a safe stage/category plus a
validated redacted host when available. Safe errors may identify validated old/new
ULIDs. A call error is class `11` only while the incumbent remains structurally
restart-safe. Any error after a successful response is class `13` while that
incumbent remains restart-safe. Loss of that proof is class `12`. Explicit
Connect/server errors remain outcome-unknown because Control may consume the
token before a later registration append fails.

### Durable attempt and recovery state

Add one schema/internal single-row SQLite reenrollment attempt record. It contains
only a version, state (`prepared`, `invoking`, `returned`, or `staged`), validated
incumbent ULID, incumbent credential/salt hashes, and—after it is recoverable—the validated
candidate ULID/hash. It contains no token, URL, key, certificate, CSR, or plaintext
credential material. Inserting `prepared` and advancing to `invoking` are durable
transactions before the remote boundary; once `invoking` is committed, a crash or
missing response is conservatively remote-outcome-unknown and never retried.

A returned successful RPC first advances the attempt to `returned` before full
candidate validation, recording the candidate ULID only if it is valid. A bare
`returned` row with no valid correlated private-key-bearing next file cannot
resume. Local persistence then creates and fully reopens
`credentials.enc.next`; only then does the row advance to `staged` with the
validated candidate identity/hash. The unavoidable crash window between next-file
durability and that SQLite transition is an explicit recovery tuple: exact
`returned` journal data plus a fully validated next file, unchanged canonical
incumbent/salt, old binding, and no conflicting artifact is atomically promoted to
`staged` before recovery proceeds, without another network call. Any mismatch
fails closed. A bare `returned` failure requires confirmed-remote cleanup or
acknowledged abort; a correlated effective or persisted `staged` state can resume.
The classifier correlates the attempt row, canonical/next credential identities
and hashes, unchanged salt, backup bytes, and SQLite management binding;
unexplained combinations fail closed.

The recovery matrix is exact: `prepared` may abort without acknowledgement;
`invoking` may only abort with `--acknowledge-remote-unknown`; `returned` may only
abort with `--acknowledge-remote-registration-confirmed`; and `staged` may resume or
abort with that confirmed acknowledgement. `reenroll recover --resume` is root-
only, lease-held, performs no network call, requires a valid correlated staged
candidate, completes any missing no-replace backup publication, and continues the
ordinary commit. Abort requires canonical incumbent bytes/salt and old binding to
match, removes every correlated pre-commit next/backup object whether partial or
complete, durably clears the row, and reports the candidate ULID when known.
Committed-replacement backups retain the stricter old-device cleanup contract and
cannot be aborted as a staged attempt. The successful identity-retirement
transaction clears the attempt row atomically with changing the binding to the
candidate.

### Backup and atomic commit

Add one credential-store operation such as `ReplaceWithBackup`; ordinary
first-enrollment/renewal writes consume the same anchored primitives but do not
create reenrollment backups.

The SDK adds a Linux dirfd-relative mechanism rather than extending the current
path-based `safe_replace.go`. It receives an already-verified directory fd and
single-component names; creates crash-invisible writable temporary objects with
`openat(O_RDWR|O_TMPFILE|O_CLOEXEC, 0600)`; writes, fsyncs, and closes them; and
publishes through `linkat`/rename/sync using that same directory fd. Agent policy
applies and verifies `fchmod`/`fchown`. `O_TMPFILE`/link publication support is
preflighted before token/network access; there is no unjournaled named temporary
ciphertext. Backup publication requires atomic no-replace
(`renameat2(RENAME_NOREPLACE)` or an
equivalent kernel guarantee). If the running kernel/filesystem cannot provide
no-replace semantics, the operation fails closed before registration; there is
no `lstat`-then-rename fallback. Before token access/network effects, preflight
uses random disposable names under the retained fd to prove no-replace both
rejects an existing destination and succeeds for an absent destination; it then
unlinks/syncs the probe entries. Any unsupported result or cleanup/durability
error fails before registration and never touches canonical/backup names.
Replacement of the active credential uses one atomic same-directory rename. Every
open/read/write/stat/chmod/chown/fsync/rename, directory-fsync, unlink, and close
error is returned.

Under the retained lock and directory fd, replacement:

1. Reopens canonical `salt` and `credentials.enc` with nonblocking no-follow
   flags, verifies metadata and exact preflight bytes, and never calls the
   create-on-missing salt path.
2. Encrypts the candidate with unchanged salt and a fresh GCM nonce.
3. Atomically creates `credentials.enc.next` no-replace, syncs the file and
   directory, then reopens/decrypts/fully validates the candidate bytes and exact
   UID-0 mode-`0600` regular metadata. The durable attempt row advances to
   `staged` only after this proof.
4. Atomically creates `salt.bak` no-replace, syncs the file and directory, then
   reopens/verifies exact bytes, UID 0, mode `0600`, regular type, and length.
5. Atomically creates `credentials.enc.bak` no-replace with the same durability
   and verification contract.
6. Performs the sole active credential commit: one atomic rename of
   `credentials.enc.next` over `credentials.enc` followed by directory fsync.
7. Reloads and fully validates canonical candidate credentials through the
   anchored descriptor, rechecks active salt equality, and reverifies both
   backups.
8. In one SQLite transaction, requires the management-device binding still equals
   the verified backup incumbent ULID; deletes every table row and setting key in
   the exact identity-bound registry; updates the binding to the canonical
   candidate ULID; and clears the attempt row. It commits no external cleanup or
   result transmission.

The active salt never changes, so no two-file active-credential transaction is
needed. Ordering is:

```text
SQLite attempt = invoking
→ returned RPC updates attempt = returned
→ credentials.enc.next durable and verified
→ SQLite attempt = staged
→ salt.bak durable and verified
→ credentials.enc.bak durable and verified
→ credentials.enc.next renamed over credentials.enc + directory sync
→ canonical candidate and retained backups reverified
→ identity-bound state retired + binding changed + attempt cleared in one transaction
```

If a post-rename durability/reload or state-transition check fails, restoration
copies the verified credential backup into a fresh anchored temp, fsyncs it,
atomically renames it over `credentials.enc`, syncs the directory, and
structurally revalidates the incumbent without consuming the backup. A failed
SQLite transition rolls back before this restore, so the incumbent binding/state
remain intact. Confirmed restoration after successful registration returns class
`13`; failed proof returns class `12` and forbids daemon start. The SQLite binding
commit is the final fallible state transition; after it succeeds, only best-effort
safe logging and exit `0` remain, and the command never restores incumbent
credentials over a store already bound to the candidate.

Committed-replacement backup files block a new reenrollment before the remote
boundary. The agent records a safe candidate-connection fact bound to the canonical
ULID after its first authenticated Gateway welcome. Root-only `reenroll cleanup-
backup` may remove backups under the lease only when that fact matches, the supplied
old ULID matches the verified backup, and root explicitly acknowledges that an
administrator's hardened `DeleteDevice` succeeded. It live-probes only the retained
backup certificate when its time class permits; historical certificates without
private keys rely on authoritative server CRL membership and the mandatory release-
E2E public/per-replica proof. Every mismatch or failed proof preserves backups.
Correlated pre-commit attempt artifacts instead use the state-specific resume/abort
contract and never require deletion of the still-active incumbent.

### Management-identity binding and state retirement

Add a single-row agent SQLite management-identity binding record with an explicit
state, active credential device ULID, and candidate-connected flag. `bound` requires
a non-empty valid ULID; a new/rebound identity starts disconnected and sets the
flag only after its first authenticated Gateway welcome;
the migration may create only the one-shot `pending_adoption` state for a
pre-existing database. The store is constructed with the canonical credential
ULID and refuses to expose scheduler rows, start dispatch, or return pending
results unless a `bound` record matches. This gate runs before the LUKS daemon,
Gateway stream, pending-result sender, scheduler, or action sync starts.

Maintain a self-discovering exact classification of every application table and
known setting key, with duplicate/stale/missing/matches-zero failures:

- **management-identity-bound:** current `actions`, `action_groups`,
  `group_members`, and `results`; `maintenance_window` and `lps_public_key`
  settings; and spec 34's occurrence, generation, interval, maintenance,
  `sync_work`, and result state;
- **machine-local retained:** `luks_state`, `luks_user_passphrase_history`,
  `lps_state`, and explicit local-admin settings such as `tty.enabled`;
- **schema/internal:** Goose migration metadata, SQLite's automatically created
  `sqlite_sequence`, the binding row, and the single-row reenrollment-attempt
  journal.

The registry discovers application tables while explicitly recognizing the exact
SQLite/Goose internal set; an unexpected internal-looking table still fails. Known
setting-key constants move into the store or a neutral leaf package so scheduler,
executor, and the classifier consume one registry without an import cycle. The
store's arbitrary key/value API does not make an unknown persisted key implicitly
safe. A new table or setting key must enter exactly one class before the guard
passes. The retirement transaction deletes all identity-bound rows/keys in foreign-key-safe
order and changes the binding from the verified old ULID to the verified new ULID.
It does not invoke scheduler removal callbacks, synthesize `ABSENT`, execute
cleanup, transmit results, or alter retained machine-local history. The new
identity therefore starts from generation zero and receives its authority only
from a fresh authenticated sync.

On ordinary upgrade, the binding migration marks a pre-existing database
`pending_adoption`; with no attempt, next-file, or backup state, startup adopts the
structurally validated canonical credential ULID exactly once without deleting state,
while the daemon lease is held and before runtime starts. Ordinary first enrollment instead
creates/migrates the store and commits a `bound` row after canonical credentials
are durable and before runtime. A crash before the database exists may create it
and bind only when canonical credentials validate and staged/backup/attempt state
is absent; a crash after migration may resume only from the explicit
`pending_adoption` marker. A missing row after the binding migration, unexplained
state, or a `bound` mismatch fails closed instead of being adopted or treated as
unenrolled. The sole automatic recovery is
an exact post-rename crash
tuple: canonical candidate and complete backups both validate under the unchanged
salt, the backup ULID equals the current database binding, and the canonical ULID
is different. Startup may then run the same idempotent retirement transaction;
any other missing/partial/mismatched proof is class `12` and leaves the service
stopped.

### Authoritative device lifecycle and revoke-before-delete

Add one shared per-device PostgreSQL lifecycle-guard callback. Every device-
targeted mutation whose authority requires a live device acquires it before any
queue, pending-row, token, secret, terminal/session, other persistence, or event
effect; audit-only appenders are classified separately. Under the lock it replays
the immutable lifecycle subset (`DeviceRegistered`, `DeviceCertRenewed`, deletion-
requested, and `DeviceDeleted`) in stream-version order and rejects after deletion.
A self-discovering guard discovers mutation entry points plus every direct/wrapped
append API, requires the guarded callback before the first effect, fails on zero
matches, and keeps creation/rebuild/audit-only exceptions explicit. Thus a mutation
already holding the lock finishes before deletion, while a later heartbeat,
inventory, queue, token, terminal, or other writer observes deletion and cannot
create side effects or overtake it.

Registration and renewal parse the emitted leaf DER before constructing events or
responses and derive exact fingerprint plus second-precision `NotBefore` and
`NotAfter`; renewal validates the presented certificate against authoritative
history, appends `DeviceCertRenewed`, and returns only after the event is durable.
Projection listener failure, cancellation, or a higher-sequence projection update
cannot change which certificate was issued; projections remain rebuildable read
models, not revocation authority. The retention layer exempts exactly
`DeviceRegistered`, `DeviceCertRenewed`, `DeviceDeletionRequested`, and
`DeviceDeleted` and updates a transactional stream-head row on every append, so
pruning unrelated events cannot erase authority or reset the next version. This
security replay, retention, and lock discipline is recorded in a server ADR.

`DeleteDevice` performs normal request validation/authz/scope before acquiring the
lifecycle lock. Under it, authoritative replay must prove a registered,
non-deleted device and enumerate every unique issued fingerprint plus encoded leaf
expiry. The handler first appends a new non-projecting `DeviceDeletionRequested`
audit event with safe actor/target metadata, then applies these exact branches:

- **No certificate ever issued:** delete without CRL only when replay proves the
  certless state; partial/malformed certificate payloads return opaque `Internal`.
- **Currently valid:** `!now.Before(NotBefore) && !now.After(NotAfter)`, matching
  Go X.509's inclusive boundaries. Require the production CRL store and successful
  idempotent revocation before deletion. Deployment E2E proves one public Traefik
  request plus fresh production-SNI internal requests to every discovered Gateway
  replica; each completes TLS and receives the exact CRL HTTP 403/log before
  Connect handling. TLS failure or later `VerifyDevice` rejection does not count.
- **Not yet valid:** `now.Before(NotBefore)`. Require CRL-store membership plus
  attributable current TLS time rejection; make no false middleware claim before
  the validity window.
- **Expired:** `now.After(NotAfter)`. Ordinary TLS already rejects before CRL
  middleware and the current CRL store intentionally omits expired entries.
  Deletion records the branch and backup cleanup requires attributable certificate-
  expiry rejection, not a false CRL claim.
- **Legacy future-expiry event without `NotBefore`:** require idempotent revocation
  and authoritative CRL membership, but do not claim whether current TLS should
  succeed. A separate newly issued TLS-valid certificate always supplies the
  mandatory public/per-replica middleware proof.

All mandatory certificate branches succeed before `DeviceDeleted` is appended.
A partial CRL success or final append failure leaves the authoritative stream
non-deleted with its immutable deletion-request event; retry replays and repeats
idempotent revocation. Success means every certificate ever issued to that device
has been handled, not merely the latest projected fingerprint. This closes both
renewal/deletion races and prior best-effort superseded-certificate revocation
failures without depending on projection application order.

### Serialized registration admission

After token-hash lookup identifies the token stream, `Register` enters the
reference-counted local gate and dedicated PostgreSQL advisory lock derived from the
token ULID that every post-creation token writer shares, then replays the retention-
preserved authority set under the lock. A self-discovering mutation/append-site
guard enforces the callback with creation/rebuild-only exceptions. Admission state—
disabled, irreversible consumption, current uses, maximum uses, and expiry—is
derived from events, not stale projection counters. New success emits
`TokenConsumed{device_id}`. Historical `TokenDisabled` with a valid non-empty
`device_id` is interpreted as consumed; empty payload is administrative disable;
malformed/ambiguous payload is opaque `Internal`. `TokenEnabled` reverses only
administrative disable. Schema/request/CSR checks remain before the lock where safe;
the authoritative decision, certificate issuance, and persistence remain inside it
so concurrent registration/admin mutation cannot reserve or restore the final use.

One `AppendEvents` batch atomically writes `TokenConsumed` and `DeviceRegistered`
bound to the same newly generated device ULID, with registration-derived
fingerprint/`NotBefore`/`NotAfter`. Batch insert, deadlock, or version failure
commits neither stream; post-commit projector failure cannot make the token reusable
because the next admission replays authority. Retention exempts exactly
`TokenCreated`, historical `TokenUsed`, `TokenConsumed`, `TokenDisabled`,
`TokenEnabled`, and `TokenDeleted`; `TokenRenamed` is not admission authority. The
transactional stream head remains even when unrelated events are pruned. Real-
Postgres tests
pause concurrent requests at the same-key lock seam, prove different token/device
keys run concurrently, and force failure on each batch insert. The stale source
comment claiming ordinary retrying `AppendEvent` rejects concurrent consumption is
removed. This preserves conservative remote-unknown treatment without preserving
the current token-only partial-commit bug.

### Startup and installer behavior

Daemon startup acquires the lifetime lease before credential inspection. A valid
canonical identity is the only runtime identity after the SQLite management-device
binding matches it or the exact post-rename recovery transition commits. Any
correlated interrupted attempt with canonical incumbent/binding intact may start
that incumbent, but blocks registration and every credential writer (including
rotation), preserves canonical bytes/journal hashes, and emits the state-specific
root recovery instruction; invalid/absent canonical state plus any attempt/backup
evidence, or any unproved binding mismatch, fails closed and never exposes ordinary
enrollment. Flag/environment first enrollment, self-test, certificate readers/
writers, updater handoff, status, and the local-socket handler all consume the same
classifier/lease-aware surface; no `Exists` or load failure falls through to
registration.

For ordinary install/upgrade, the production binary exposes a root-only
pre-start metadata-preparation path backed by the component-walk helper. It may
create a truly absent final data directory under verified parents and may repair
previously accepted root-owned non-writable `0755`/`0750` directory metadata and
known regular credential/lock files by `fchmod`/`fchown` on already-open fds.
Group/world-writable directories, symlinks, nonregular entries, and I/O ambiguity
are rejected, never repaired. Strict classification runs after this preparation.
A one-shot `install.sh --reenroll` against an older installation performs this same
ordinary upgrade/migration phase after stop and before reenrollment status. The
strict `reenroll` subcommand itself never repairs metadata, and neither installer
branch calls the legacy path-based shell `create_directories` for credential state.

Add side-effect-free root-only `credential-status --data-dir PATH`. It acquires
and releases the same lease, opens no token, performs no network call or repair,
and never reuses `OpenExisting`/the normal writable store open. A dedicated
fd-anchored SQLite inspection path requires an existing verified regular database,
opens it read-only/query-only without `MkdirAll`, migration, chmod/chown, or WAL/
schema mutation, and closes it before releasing the lease. It returns exact machine
exits: `0` startable canonical with no attempt state and either no backup or a fully
verified committed-replacement backup; `3` confirmed absence; `4` a correlated
interrupted attempt (`prepared`, `invoking`, `returned`, or `staged`) with startable
incumbent; and `14` invalid, ambiguous, lock-held, or otherwise indeterminate. Human text is not parsed. Ordinary
installation validates syntax, records service activity,
stops the daemon, runs metadata preparation, and then calls this status. Exit `0`
restarts the incumbent and reports token unused; `3` proceeds to first enrollment;
`4` makes no registration call, restarts a previously active incumbent with all
credential writers disabled, and prints the exact state-specific abort/resume and
acknowledgement requirement; `14` leaves the service stopped.

`install.sh --reenroll` is explicit; `--server`/`--token` alone never infer
replacement. Add installer `--token-file PATH`; reenrollment requires it and
rejects plaintext `--token`, while initial enrollment may retain the legacy form
with documentation preferring token files. Before stopping systemd, the installer
runs the binary's side-effect-free reenrollment syntax-validation mode. It parses
all command arguments and URL/pin grammar but does not open state/token files,
acquire the lease, repair metadata, or contact Control; class `2` therefore occurs
before stop.

After syntax passes, the installer records whether the service was active, stops
it, completes the fd-anchored ordinary upgrade/migration preparation, verifies
status is startable with no unresolved attempt, and invokes the strict production
command with the same resolved data directory written into systemd. A preparation/
status failure makes no registration call and follows the status restart/stop rule.
The child uses signal-aware context: cancellation before the remote
boundary maps to `10` or `14` according to proven incumbent safety; cancellation
after the durable boundary maps to `11`; cancellation after a successful response maps to
`13` unless local state is ambiguous (`12`). The installer starts the candidate
on `0`; restarts a previously active incumbent only on `10`, `11`, or `13`; and
leaves the service stopped on `12`, `14`, any unexpected exit, signal death, or
missing/unparseable status. It never infers state from message text.

### Database, proto, and dependencies

- **Server database:** add a forward migration for transactional
  `event_stream_heads`; exempt exactly `TokenCreated`, historical `TokenUsed`,
  `TokenConsumed`, `TokenDisabled`, `TokenEnabled`, `TokenDeleted`,
  `DeviceRegistered`, `DeviceCertRenewed`, `DeviceDeletionRequested`, and
  `DeviceDeleted` from retention. Add irreversible `TokenConsumed` and
  non-projecting `DeviceDeletionRequested` events plus authoritative lifecycle/token replay
  helpers. Replace the process-global advisory-lock pre-gate with reference-counted
  per-key local gates while retaining one dedicated PostgreSQL session lock; same
  keys serialize and unrelated device/token keys run concurrently. Write a server
  ADR for retention-safe security replay and the stop-the-world activation.
- **Agent SQLite:** add the single-row stateful management-device binding, single-row safe
  reenrollment-attempt journal, exact table/setting classification, and
  transactional retirement path. The migration marks existing databases
  `pending_adoption`; they bind their validated incumbent ULID once before runtime
  only when no attempt, next-file, or backup state exists. New enrollment writes `bound` before
  runtime; spec 34's later tables/keys register in the same classifier.
- **Proto:** none.
- **SDK:** add the Linux dirfd/component-walk primitive, exact base-URL parser,
  and registration-only final-client redirect plus 256 KiB Connect read limit.
  Do not route this contract through the current path-based `safe_replace.go`.
- **Dependencies:** no new Go module. Use Go/syscall support already present on
  Linux; if atomic no-replace is unavailable at runtime, fail closed.

## Security considerations

- **Authorization:** effective UID 0 and possession of the exclusive daemon-shared
  lease are required. A registration token alone cannot replace root-owned
  management identity or use the mode-`0666` enrollment socket for replacement.
- **Trust anchor and identity:** the optional pin is SHA-256 of the sole CA DER.
  Candidate verification uses only that CA, exact agent leaf identity/SAN/EKU/
  key-usage sets, private-key match, and current-time chain validation. Incumbent
  structural safety checks the same authority relationships separately from time
  validity so expiry is not confused with local corruption.
- **Endpoint authority:** the exact parser rejects whitespace, port-only hosts,
  userinfo, paths, query, fragment, invalid ports, redirects, and non-HTTPS
  schemes. Every new candidate string is exact-valid. Previously accepted
  incumbent strings may pass only the bounded read-only legacy parser and remain
  byte-identical; an empty legacy incumbent `ControlAddr` remains restart-safe and
  continues to disable renewal rather than being silently inferred or rewritten.
- **Secret handling:** reenrollment accepts only a protected nonblocking-opened
  token file; candidate keys remain in memory until encrypted persistence, and the
  agent emits no token/key/certificate plaintext or rejected/raw URL into logs or a
  spawned subprocess argv. Legacy initial-install
  `--token` remains separately documented and is not called argv-secret-free.
- **Path integrity:** every ancestor is opened from `/` without following
  symlinks; final named entries are nonblocking no-follow opens followed by
  `fstat`. Same-dirfd operations and required atomic no-replace semantics avoid
  path substitution and racy existence checks.
- **Race prevention:** the process-lifetime lease excludes rotation, local
  enrollment, startup, and reenrollment. Anchored reopens and byte comparisons
  reject replacement races. Server lifecycle and token mutations share their
  respective aggregate locks and derive admission/revocation state from immutable
  events rather than projections.
- **Crash consistency:** immutable active salt plus one atomic ciphertext rename
  yields old-or-new canonical identity. A durable attempt row and reopened staged
  candidate precede durable verified backups, so every pre-commit crash has an
  explicit resume/abort path; failed restoration is explicitly ambiguous. A post-
  rename crash cannot expose old state because runtime is gated by the SQLite
  binding and can complete only the exact correlated transition.
- **Identity isolation:** actions, work, results, signed policy, and the old
  Control-signed LPS key are retired without cleanup or re-attribution before the
  new identity runs. Machine-local LUKS/LPS history and local-admin policy are
  preserved only through an explicit exact classification.
- **Remote ambiguity:** local rollback cannot undo Control. Invocation errors are
  outcome-unknown (`11`), returned-success/local-failure is confirmed (`13`), and
  neither is silently retried.
- **Revocation:** successful old-device deletion means every issued certificate
  was classified from retention-safe authority: future-expiry fingerprints were
  durably revoked before deletion, while expired fingerprints use the explicit TLS-
  expiry branch. Real-handler/Postgres tests use injected clocks and authoritative
  event fixtures for expired, not-yet-valid, and legacy-time histories. Deployment
  E2E always proves one newly issued still-TLS-valid retained certificate through
  the public Traefik path and each Gateway replica directly with production SNI;
  synthetic time histories never substitute for CRL-middleware proof. Per-host
  backup cleanup live-probes only the retained backup certificate; historical
  certificates without retained private keys rely on authoritative server CRL
  membership and release evidence.
  Already-admitted streams are not claimed terminated.
- **Audit:** atomic registration events and `DeviceDeletionRequested`/
  `DeviceDeleted` provide immutable remote evidence, including revoke-success/
  delete-append-failure attempts. The local attempt row and command logs contain
  only safe states, hashes, validated ULIDs, and counts—never credential material.

## Test requirements

### Credential-store tests

- Saving two valid identities preserves exact salt while fresh GCM nonces change
  ciphertext; a custom directory proves no lock/canonical/next/temp/backup access
  falls back to `credentials.DefaultDataDir`.
- Table-driven component walking rejects an ancestor or final symlink,
  non-directory ancestor, wrong owner/mode, replacement race, and every
  permission/I/O error. Final data/token/credential/next/backup entries cover FIFO,
  socket, device, directory, symlink, and regular-file substitutions; FIFO opens
  are proven nonblocking. Raw helper names reject empty, `.`, `..`, absolute,
  slash-containing, NUL, repeated/trailing-separator, and multi-component input.
- Every retained directory/file/lock descriptor asserts `FD_CLOEXEC` via `F_GETFD`
  and is proven absent in an executed child process.
- Classified state covers exact all-absent, salt-only, credential-only,
  inaccessible, corrupt/decrypt/parse failure, wrong salt length, prepared/
  invoking/returned/staged attempt rows, valid/invalid next, every partial backup order,
  complete backup, valid canonical-with-backup, and stale/unmatched combinations.
  Confirmed absence also requires no database or no binding/identity-bound state;
  only correlated states permit their state-specific resume or abort.
- Dirfd primitive tests substitute an ancestor or named entry between every
  open/stat/read/write/chmod/chown/fsync/close/link/rename/directory-sync operation
  and prove no access escapes the retained descriptor. Unsupported `O_TMPFILE`,
  link publication, or `RENAME_NOREPLACE` fails before network effects; no named
  unjournaled temp or check-then-rename fallback exists. Kill points during temp
  write, metadata application, fsync, close, link, and rename leave no unexplained
  named ciphertext.
- Successful replacement durably reopens/validates `credentials.enc.next` before
  creating backups, preserves active salt, and leaves exact UID-0 mode-`0600`
  incumbent backups. Fault injection proves next and each backup are byte/metadata-
  verified before the active rename.
- Salt/canonical changes after preflight reject before publication. Every file and
  directory error, including close and directory fsync, is surfaced.
- Kill points after attempt preparation/invocation, returned success, next-file
  durability, each backup operation, the active rename, and before/after SQLite
  retirement restart into one classified state. Correlated pre-rename states can
  resume or abort without network; post-rename failure returns class `13` only
  after incumbent restoration is structurally proven, otherwise class `12`; no
  state exposes old-identity runtime data to the candidate.
- A populated store bound to old device A transitions in one transaction to new
  device B: action/group/result rows and identity-bound settings disappear, the
  binding changes, the attempt row clears, retained LUKS/LPS history and
  `tty.enabled` remain, and no cleanup callback runs. Injected failures roll back
  row deletes, binding, and attempt state together.
- The self-discovering table/setting classifier has exact-set, duplicate, stale,
  missing, and matches-zero red-checks; it recognizes exactly Goose metadata and
  `sqlite_sequence`, consumes centralized setting-key constants without import
  cycles, and includes spec 34's occurrence/work/generation keys when present.
- First-enrollment kill points after credential publication and before database/
  binding commit recover only from absent database or explicit `pending_adoption`;
  a missing migrated row, stale identity-bound rows, or mismatched `bound` state
  fails closed. Ordinary enrollment always commits `bound` before runtime.
- Ordinary-upgrade preparation repairs verified `0755`/`0750` directory and
  permissive/non-root regular-file metadata by fd, rejects writable/symlink/
  nonregular state, and leaves reenrollment input byte/metadata-identical.

### Command and daemon tests

- Syntax-only mode returns `2` for missing/conflicting flags, relative/root data
  paths, repeated/trailing separators, `.`/`..` components, malformed pin, and
  invalid exact URL grammar without state/token/network access. Runtime non-root,
  unsafe/uninspectable data path, invalid incumbent, every existing attempt state,
  and lock-held cases assert **zero token opens** through an access-
  count seam, make no remote call, and return the specified class; real FIFO input
  additionally proves those early guards cannot block on token access.
- Token cases cover every ancestor/final substitution plus relative path,
  wrong owner/mode, FIFO/socket/device/directory, empty/whitespace-only content,
  over-4096-byte file, and trimmed length above 255; nonregular inputs never hang.
- Correct/absent/wrong hostname, agent version, token, and CSR generated/semantic
  constraints cover the exact UTF-8/ASCII/character, no-control, PEM count/type,
  P-256, subject, extension, signature, and key-match rules before `invoking`; an
  equality test proves the validated request is the request sent. Every rejection
  makes zero HTTP requests. Registration is invoked once under 45 seconds with no
  application retry; transport-level replay is not misreported as impossible.
  Timeout, signal cancellation, call construction, reset, decode failure, or
  Connect error after the `invoking` commit map to `11` with exact incumbent
  hashes; a successful response followed by candidate/pre-rename rejection maps to
  `13`.
- Connect compressed and uncompressed response bodies at 256 KiB and 256 KiB+1
  prove the registration read limit runs before candidate allocation/validation;
  oversize maps to remote-unknown without changing canonical bytes.
- Redirect 301/302/303/307/308 tests reuse one caller-owned client whose
  `CheckRedirect` would allow replay, then prove `RegisterAgent` rejects the
  redirect on its copy, only the original endpoint is reached, and the token/body
  never reaches the target. Before/after assertions prove caller `CheckRedirect`,
  `Transport`, `Timeout`, and `Jar` are unchanged; renewal and CRL retain their
  existing client behavior.
- URL tables reject whitespace, case-variant/non-HTTPS scheme, opaque URL,
  port-only/missing hostname, empty/zero/65536 port, userinfo, path/trailing slash,
  query, forced query, and fragment. Exact accepted Control/Gateway strings survive
  persistence and are used by renewal and CRL calls. Log-capture cases put a
  sentinel secret in rejected userinfo/unparseable input and prove no entry point
  emits it or the raw URL.
- CA parsing rejects zero/multiple/wrong-type PEM blocks and trailing garbage. Leaf
  tables reject invalid ULID/CN/subject-serial, missing/extra/wrong URI SAN,
  any DNS/IP/email SAN, non-exact EKU or key usage, `IsCA`, non-CA/invalid/
  expired chain, untrusted issuer, key mismatch, and DER-pin mismatch.
- Incumbent tests independently cover valid-current, expired, not-yet-valid, bad
  signature/profile/key/Gateway URL, invalid non-empty Control URL, empty legacy
  `ControlAddr`, and encrypted fixtures for each previously accepted URL class
  (surrounding whitespace, case-variant scheme, path, query, and trailing slash).
  Legacy-compatible bytes remain unchanged and are never accepted for a candidate;
  time-only invalidity and empty legacy Control address are restart-safe, while
  structural failure is not.
- Success returns `0`, reports validated different old/new ULIDs, and retains
  backups. A same-ULID successful response remains `returned`, returns `13`, keeps
  canonical bytes unchanged, and requires confirmed-remote cleanup. Signal tests
  before the `invoking` commit, after it, and after returned success produce
  `10`/`14`, `11`, and `13` respectively unless local state is `12`.
- State-matrix tests cover direct reenroll, `credential-status`, installer, and
  recovery for `prepared`, `invoking`, `returned`, and `staged`: only staged resumes;
  each abort requires its exact acknowledgement and returns `10`, `11`, or `13`.
  Next publication/verification failure remains `returned` and cannot resume;
  backup failure after verified next remains `staged` and may resume or abort.
- Daemon lifetime lock excludes reenrollment during rotation. While any attempt row
  exists, runtime credential writers/rotation remain disabled and canonical hashes
  stay fixed. Live-update tests prove the parent holds the lease, passes a bounded
  sealed memfd snapshot only to the verified candidate self-test, and leaks neither
  lock/data-dir fd nor snapshot into later execs; standalone self-test contends for
  the ordinary lease. Daemon flag/env and
  local-socket first enrollment each register only on confirmed all-absent state;
  valid, corrupt, inaccessible, salt-only, database/binding-only, and backup states
  never fall through. The credential-call-site guard discovers every production
  reader/writer/registration decision, rejects path-based `Load`/`Save`/`Exists`,
  and has stale, exception, and matches-zero red-checks.
- Valid canonical plus backup starts only when the database binding matches the
  canonical ULID. A binding equal to the valid backup incumbent ULID and a
  different valid canonical candidate completes the exact idempotent retirement
  before pending-result sync or scheduler construction; partial/mismatched proof
  fails closed without exposing the enrollment socket.
- Explicit CLI data-dir beats the environment; environment applies only when the
  flag is absent. Unit, installer preparation, status, daemon, and reenroll tests
  compare the opened directory inode and prove all select the same authority.
- Read-only status/preflight snapshots inode set, bytes, ownership, modes, and
  relevant timestamps before/after inspection and proves no mkdir, migration,
  PRAGMA/WAL/schema write, chmod/chown, token open, or network access occurs.
- Runtime-order tests prove old unsynchronized results are never sent under the new
  certificate, old actions/work never dispatch, the binding's connected flag is set
  only after authenticated Gateway welcome, and the new identity accepts its first
  lower per-device generation after retirement.
- Cleanup-backup tests require root/lease, matching connected candidate and old ULID,
  explicit delete acknowledgement, valid backups, and applicable retained-cert
  proof. Success durably removes only backups; every mismatch/probe/fsync failure
  returns `14`, preserves bytes, and does not claim fleet-wide historical proof.

### Server registration regression tests

- Real `Register` handler plus real Postgres runs concurrent schema-valid calls for
  one-time tokens and max-use boundaries; exactly the allowed count succeeds and
  each success has one irreversible `TokenConsumed` atomically paired with one
  `DeviceRegistered` carrying the same device ULID and DER-derived certificate
  times.
- Concurrent token disable/enable/update and registration prove every post-creation
  token writer shares the same-key lock, different keys progress concurrently, and
  authoritative replay wins over stale projection `disabled/current_uses` values.
  `TokenEnabled` never reverses `TokenConsumed`; historical consumed/admin-disabled
  payloads and malformed ambiguity cover their exact branches. The self-discovering
  mutation/append-site guard has stale, missing, duplicate, and matches-zero red-
  checks.
- Deterministic insert hooks fail the token and device member of the atomic batch in
  turn; both streams remain unchanged and the RPC reports the mapped failure. A
  token-projector failure after a committed batch cannot admit another use.
- Retention tests prune unrelated old token/device events and run pruning
  concurrently with registration/deletion. Authority events and transactional
  stream heads survive, versions never rewind, and a pruned projection/history
  cannot admit another token use or lose a certificate.
- Registration/renewal CA tests parse the emitted DER and assert exact CN/subject
  serial, one agent URI SAN, empty DNS/IP/email SANs, exact ClientAuth-only EKU,
  exact key usage, `IsCA=false`, key match, and response/event fingerprint,
  `NotBefore`, and `NotAfter` equality using a clock with non-zero nanoseconds.

### Server deletion regression tests

- Real `DeleteDevice` handler plus real Postgres and CRL backend covers correct,
  absent, malformed, unauthenticated, wrong-permission, out-of-scope, and unknown
  device requests under existing auth conventions.
- Authoritative replay covers one/multiple renewals, duplicate fingerprints,
  certless registration, partial/malformed fingerprint/`NotBefore`/`NotAfter`
  payloads, current, expired, not-yet-valid, and legacy future-expiry events lacking
  `NotBefore`, both exact time equality boundaries, prior deletion request, and
  already-deleted state. These time classes use injected clocks and authoritative
  event fixtures rather than impossible public issuance. Certless proof deletes
  without CRL; malformed/partial authority returns opaque `Internal` and no
  `DeviceDeleted`.
- Missing CRL wiring or CRL write failure for any future-expiry certificate returns
  opaque `Internal`; `DeviceDeletionRequested` remains durable and retryable while
  `DeviceDeleted` and its projection transition are absent. Expired-only history
  follows the explicit no-CRL branch.
- A self-discovered race matrix pauses every live-device mutation at the lifecycle
  guard, including heartbeat/seen/inventory, renewal, queue/pending work, tokens/
  secrets, terminal/session setup, and deletion. A mutation already holding the
  lock completes before deletion; every later path replays `DeviceDeleted`, creates
  zero queue/token/secret/session/persistence effects, and returns its exact terminal
  rejection. Deletion revokes every issued future-expiry fingerprint, including a
  superseded certificate whose earlier best-effort revocation failed.
- Projector failure/cancellation and a higher-sequence heartbeat projected before
  an earlier renewal prove deletion still revokes the exact certificate returned
  by renewal. Zero affected projection rows cannot change authoritative behavior.
- Injected final deletion-append failure after one/all successful revocations leaves
  the device stream non-deleted with immutable request evidence; retry is safe and
  eventually appends deletion. Event ordering proves request → CRL effects → delete.
- Gateway integration always uses one fresh public Traefik-path probe plus a
  separate internal actor that discovers each Gateway replica and connects directly
  with production SNI. A newly issued TLS-valid old certificate completes TLS and
  receives the exact CRL HTTP 403/log on the public route and every replica. TLS
  failure or later entity lookup does not count as revocation proof; the other
  certificate-time classes remain in the real-handler/Postgres matrix above.
- Activation tests stop all old Control replicas before enabling the authority
  model, preserve the old renewal-lock namespace, and refuse traffic when history
  scan finds malformed token authority or renewal/mutation after `DeviceDeleted`.
  Reconciled legacy histories prove required revocation and version continuity.
- The self-discovering device-mutation/append guard covers every live-device entry
  point and append wrapper with stale, missing, duplicate, audit/creation exception,
  and matches-zero red-checks.

### Installer and deployment E2E

- `credential-status` exact exits cover startable, absent, each correlated
  `prepared`/`invoking`/`returned`/`staged` state, and invalid/lock-held states with
  no token open, repair, writable SQLite side effect, or network access. Normal
  reinstall stops before inspection, restarts a startable identity and reports
  token unused only for that class, enrolls only confirmed absence, restarts an
  interrupted incumbent with credential writers disabled, and leaves invalid state
  stopped.
- Explicit reenrollment refuses plaintext `--token`, accepts `--token-file`,
  forwards custom `--data-dir`, runs syntax validation before stop, and never calls
  path-based directory repair. Installer process tests prove `0` starts candidate;
  `10`/`11`/`13` restart only a previously active incumbent; and `12`/`14`, child
  signal death, unknown exit, or interrupted status leave the service stopped.
- Ordinary upgrade invokes fd-anchored metadata preparation. A one-shot installer
  reenroll on a pre-spec installation completes the same preparation/migration
  phase before strict status/reenroll, while the reenroll command itself never
  repairs. Symlink/nonregular upgrade state fails before service start.
- Spec 37's core orchestration, reviewed three-key manifest, stable lane/readiness
  registry, and active `agent-socket` baseline land first. Ordinary install,
  `credential-status`, initial enrollment, and non-replacement assertions remain in
  `agent-socket`; this lane reuses status only for reenrollment-specific interrupted
  attempt/backup and installer-reenroll control flow. The compatible agent artifact
  registers `offline-reenrollment-v1` only with the complete production-binary lane
  keyed `agent-reenrollment`. Changes to credential classification, lifecycle
  deletion, installer, or reenrollment merely schedule the already-ready lane and
  do not create readiness.
- The real-agent lane uses a custom data directory and production ownership/modes;
  proves lock rejection, ancestor/final no-follow races, nonblocking nonregular
  rejection, redirect refusal, response loss after Control-side effect, every
  reenrollment-specific remote/local/status exit class, and byte-identical incumbent
  preservation. Kill points around attempt/next/backups/rename demonstrate state-
  specific resume and acknowledged abort without another registration. Old actions/
  policy arrive only through deployed APIs and signed sync; old results arise
  through real execution/persistence—direct SQLite inserts/updates are forbidden.
  The candidate neither dispatches nor uploads them and starts from an empty
  management namespace. The lane then proves candidate connection, retained
  backups, authoritative old-device deletion, mandatory TLS-valid public plus per-
  replica CRL HTTP rejection, and lease-held cleanup-backup success/refusal without
  pretending to live-probe unavailable historical private keys.

## Rejection paths

| Scenario | Exit/result | Operator-visible message | Logged context |
|----------|-------------|--------------------------|----------------|
| Usage/required-argument/URL/pin/recovery acknowledgement invalid | `2` before stop/state/network | Correct invocation; no state claim | Flag/category only; no token/pin/raw URL |
| Non-root, unwalkable/unsafe data path, or lock not acquired | `14`; zero token opens/no remote call | No service-state claim; installer leaves stopped only if it stopped the service | Safe stage/path basename and category |
| Credentials/artifacts/database management state all confirmed absent | `14`; direct to ordinary enrollment | No credential files created | Confirmed-absent state only |
| Corrupt/inaccessible canonical, salt, database, or binding state | `14`; fail closed | Not unenrolled; explicit recovery required | Safe operation/basename/category; no bytes |
| Startable canonical identity plus committed-replacement backup | Main `10` before registration; status `0` | Token unused for ordinary install; use cleanup-backup only after old-device cleanup | Backup-presence state only |
| Correlated `prepared` attempt | Main `10`; status `4`; abort→`10` | Abort prior local attempt; no remote acknowledgement | Attempt state and validated incumbent ULID/hash only |
| Correlated `invoking` attempt | Main `11`; status `4`; acknowledged abort→`11` | Remote outcome unknown; never retry automatically | Attempt state and validated incumbent ULID/hash only |
| Correlated `returned` attempt | Main `13`; status `4`; confirmed abort→`13`; no resume | Remote registration confirmed; cleanup/abort required | Attempt state and validated ULIDs/hashes only |
| Correlated `staged` attempt | Main `13`; status `4`; resume→`0` or confirmed abort→`13` | Resume without network or acknowledge confirmed remote registration | Attempt state and validated ULIDs/hashes only |
| Uncorrelated next/attempt/backup or invalid canonical with attempt state | `14` / startup fail closed | Do not overwrite or start blindly | State categories and safe basenames only |
| Token/request field/CSR invalid before `invoking` | `10`; zero HTTP requests | Incumbent restart-safe; fix local input | Validation category; no token/CSR value |
| Registration redirect | `11`; not followed/no application retry | Incumbent restart-safe; remote outcome unknown | Validated redacted host/status; no Location/token |
| Failure/signal after durable `invoking` boundary | `11`; no application retry | Incumbent restart-safe; remote side effect unknown | Safe transport/Connect category and validated host |
| Returned success but candidate or same-ULID response is invalid | `13`; state remains `returned` | Incumbent unchanged; remote cleanup/confirmed abort required | Validation stage and validated ULIDs only |
| Next publication/verification fails after success | `13`; state remains `returned` | Cannot resume; remote cleanup or confirmed abort | Local stage/basename and safe error |
| Backup publication fails after verified next | `13`; state is `staged` | Resume or confirmed abort without another registration | Local stage/basename and safe error |
| Crash before active rename after remote boundary | No trustworthy child status; installer leaves stopped | Incumbent remains canonical; inspect exact attempt state | Next status reports attempt/next/backup classes |
| Crash after active rename | No trustworthy child status; installer leaves stopped | Candidate starts only after binding recovery | Validated canonical/backup/binding classes |
| Post-rename failure, incumbent restore proven | `13` | Incumbent restoration confirmed; resolve remote/staged state | Failed stage and restoration-confirmed state |
| Post-rename failure, restore not proven | `12` | Do not start daemon; explicit local recovery required | Failed stage and ambiguous-local state |
| Canonical ULID/binding mismatch without correlated proof | Startup failure / `12` | Service remains stopped; inspect transition state | Validated old/new/bound ULIDs when available |
| Identity retirement transaction fails after candidate publication | Restore incumbent and `13`; `12` if unproved | Restart only after state/credential agreement | Validated ULIDs, transaction stage, safe DB category |
| Service stop/start or child-status handling fails | Installer non-zero; no inferred identity claim | Inspect service and credential-status before manual start | Unit operation and numeric child/status class only |
| Cleanup-backup proof/acknowledgement/ULID mismatches | `14`; backups unchanged | Candidate/delete proof incomplete; retain rollback | Safe proof category and validated ULIDs only |
| Token allowance exhausted/consumed/admin-disabled | Connect `PermissionDenied`; no partial batch | Registration token unavailable | Token ID and admission category; no token value |
| Token lock/replay/decode/batch infrastructure fails | Connect opaque `Internal`; no partial batch | Registration failed safely | Token ID and safe stage/category |
| Post-deletion user mutation | Existing non-enumerating `NotFound`; zero side effects | Device not found | Actor, method, device ULID; no secret material |
| Post-deletion heartbeat/seen/inventory | Terminal acknowledged drop; zero side effects | Agent must stop/re-enroll as existing protocol defines | Device ULID, writer class, deleted state |
| Device lock/replay/decode infrastructure fails | Connect opaque `Internal`; no side effects | Device operation failed safely | Device ULID and safe stage/category |
| Certless authoritative history | Delete success without CRL | Device deleted; no certificate existed | Device ULID and certless branch |
| Future-expiry CRL store/revoke fails | Connect `Internal`; deletion request only | Old device remains; retry revocation | Device ULID and opaque certificate index/stage |
| Partial/malformed authoritative certificate history | Connect `Internal`; no `DeviceDeleted` | Reconcile event history before retry | Device ULID and payload category; no cert material |
| Revocation succeeds but final deletion append fails | Connect `Internal`; request event remains | Safe to retry deletion | Device ULID and append stage |
| Successful replacement | `0` with different old/new ULIDs | Candidate bound/active; remote old identity and backups retained | Validated ULIDs, retired-row safe counts, success only |

## Rollout and migration

Land spec 37's core harness, reviewed three-key manifest, exact lane/readiness
registry, and complete active `agent-socket` baseline first. Merge the compatible
SDK component-walk/dirfd/URL/client limits, server retention-safe token/lifecycle
security authority, and agent lock/classifier/attempt/binding/CLI/installer work.
Record the exact resulting commit objects from those reviewed changes as `sdk_sha`,
`server_sha`, and `agent_sha`; never re-resolve a branch head or matching tag.
Verify release-branch reachability and that the server/agent dependency graphs
resolve the recorded `sdk_sha`, then rerun the complete gate. Descriptor
fingerprints, binary hashes, and image digests are recorded separately. Only that
green manifest-triggered gate may create repository tags/releases or promote the
tested OCI digests. No member releases early.

Server activation is stop-the-world or equivalently traffic-fenced: every old
Control replica is drained before the retention-safe stream-head migration/history
scan enables registration, renewal, deletion, and other guarded writers; the
existing renewal lock namespace is preserved. The daemon participates in the
configured-directory lifetime lease and store-binding gate from the first release
containing `reenroll`; a command-only/default-path lock is unsafe. Register
`offline-reenrollment-v1` only in the compatible agent artifact that carries the
complete green `agent-reenrollment` lane. That lane plus spec 37's already-active
`agent-socket` and ready `agent-signed-sync` lanes must be green before the
exhaustive gate blocks release.

The encrypted credential format and 32-byte active salt do not change. Ordinary
upgrade performs the fd-anchored metadata transition before service start, creates
`credentials.lock`, adds the attempt journal, marks an existing database
`pending_adoption`, adopts the validated incumbent ULID exactly once only with no
attempt/backup state, centralizes/classifies every existing table/key, and preserves
legacy-compatible endpoint bytes. It repairs only verified regular paths that prior
releases accepted. A one-shot `install.sh --reenroll` performs this ordinary upgrade
phase before strict status/reenroll; the reenroll command itself performs no repair
or unbound adoption. Previous manual move/delete instructions remain only as
labeled old-binary recovery. Backup cleanup uses the explicit command, successful
candidate-connection fact, old-ULID/delete acknowledgement, retained-certificate
proof, and deployment evidence for historical/fleet-wide revocation.

## References

- `agent/internal/credentials/credentials.go`
- `agent/internal/deviceauth/enroll.go`
- `agent/cmd/power-manage-agent/main.go`
- `agent/cmd/power-manage-agent/cmd_enroll.go`
- `agent/cmd/power-manage-agent/cert_rotation.go`
- `agent/install.sh`
- `sdk/client.go` — shared bootstrap client and caller-option ordering.
- `sdk/url.go` — current validator that trims input and checks `Host` rather than
  returning an exact canonical base URL.
- `sdk/sys/fs/safe_replace.go` — current path-based primitive; not sufficient for
  the dirfd contract.
- `server/internal/api/registration_handler.go` — token-before-device event order.
- `server/internal/api/device_handler.go` — current delete-before-best-effort-
  revoke ordering.
- `server/internal/api/certificate_handler.go` — existing per-device renewal lock.
- `server/internal/handler/agent.go` — Gateway CRL admission layer.
- `server/internal/ca/ca.go` — server-authored agent certificate profile.
- ADR 0013: enrollment trust model.
- ADR 0014: secrets-at-rest hardening.
- Spec 37: exhaustive deployment E2E gate.
