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
serialize concurrent one-time/max-use admission. Spec 40 (split from this spec
2026-07-18) makes those two events one token-serialized atomic batch, but a lost
response or post-response local failure can still leave an orphan remote
identity. Reenrollment therefore preserves the known-working local identity on
every pre-commit failure and never hides possible or confirmed remote side
effects behind an automatic retry.

## Acceptance criteria

1. Given valid existing credentials, no retained backup or reenrollment attempt, and a
   stopped daemon, when root runs `reenroll` with the installed data directory,
   valid HTTPS Control URL, and protected token file, then each of the following
   holds as its own testable guarantee:
   a. exactly one SDK registration invocation is made, with no
      application-level retry and no followed redirect;
   b. the candidate is fully validated and its ULID differs from the incumbent
      ULID;
   c. the incumbent is backed up before the candidate becomes canonical;
   d. the candidate is committed by exactly one atomic rename;
   e. the local management-state binding is transitioned from the old to the
      new device ULID;
   f. the command reports both ULIDs.
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
6. Confirmed absence is an exact conjunction, and every failure to prove it is
   fail-closed. Each edge carries a named mandatory test:
   a. `reenroll` directs the operator to ordinary enrollment only when
      canonical credentials, salt, `credentials.enc.next`, both retained
      backups, and the durable reenrollment-attempt row are all truly absent,
      and either the entire agent database is absent or read-only inspection
      proves no management binding and no identity-bound row or setting;
   b. a stat error is never classified as unenrolled
      (`TestReenroll_StatErrorNotAbsence`);
   c. a permission error is never classified as unenrolled
      (`TestReenroll_PermissionErrorNotAbsence`);
   d. an I/O error is never classified as unenrolled
      (`TestReenroll_IOErrorNotAbsence`);
   e. a decrypt failure is never classified as unenrolled
      (`TestReenroll_DecryptErrorNotAbsence`);
   f. a parse failure is never classified as unenrolled
      (`TestReenroll_ParseErrorNotAbsence`);
   g. a salt error (missing, wrong-length, unreadable) is never classified as
      unenrolled (`TestReenroll_SaltErrorNotAbsence`);
   h. an identity or binding mismatch is never classified as unenrolled
      (`TestReenroll_IdentityErrorNotAbsence`);
   i. the same classifier and the same edge guarantees apply at every other
      registration entry point — daemon flag/environment startup and
      local-socket enrollment — each with its own named tests
      (`TestDaemonStartup_<Error>NotAbsence`,
      `TestSocketEnroll_<Error>NotAbsence`).
7. The remote boundary decomposes into:
   a. given valid local inputs, the durable transition to attempt state
      `invoking` is the conservative remote-side-effect boundary — nothing
      before it can have a remote effect, everything after it may;
   b. exactly one `sdk.RegisterAgent` invocation is made, under a 45-second
      deadline, with no application-level retry;
   c. every redirect is rejected on the final client;
   d. an arbitrary caller transport may perform protocol-level replay the SDK
      cannot suppress; the contract claims one invocation, never one wire
      write, and the SDK does not claim byte-level proof that a failed request
      never reached Control;
   e. any failure, signal, or crash after the `invoking` commit is classified
      `remote unknown`;
   f. a returned success followed by local candidate/commit rejection is
      classified `remote registration confirmed`.
8. Given registration returns a candidate, then exactly one CA `CERTIFICATE` PEM
   block with no extra block/garbage is parsed, pinned, and used as the sole root.
   The leaf has the returned ULID in CN/subject serial, exact agent URI SAN and
   ClientAuth-only EKU sets, no DNS/IP/email SAN, `IsCA=false`, exact production
   key usage, matching local key, and a current-time-valid chain to that CA.
   Canonical Control/Gateway HTTPS base URLs and the optional CA pin also pass.
9. Pre-commit failure preservation decomposes into:
   a. given any registration/validation/local-persistence failure before the
      active rename, `credentials.enc` and `salt` remain byte-for-byte
      unchanged;
   b. the result separately reports exactly one remote class: no remote call,
      remote outcome unknown, or confirmed remote registration requiring
      cleanup;
   c. the result independently reports whether the incumbent is structurally
      restart-safe;
   d. neither remote-side-effect class ever recommends retry.
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
13. Crash consistency decomposes into:
    a. given a process crash before the active rename, canonical incumbent and
       its management-state binding remain authoritative while the durable
       attempt row, staged candidate, and partial/complete backups classify the
       exact resume or abort path;
    b. given a crash after the active rename but before local state rebinding,
       startup recognizes the exact canonical-candidate/backup-incumbent/
       bound-old-ULID tuple and completes the idempotent retirement transaction
       before runtime starts;
    c. no crash point exposes a new salt with old ciphertext, an old salt with
       new ciphertext, or old-identity scheduler/results state to the new
       identity.
14. Given an error after the active rename during directory durability or
    post-commit reload validation, then the command attempts anchored atomic
    restore from the verified backup. It reports either confirmed incumbent
    restoration or a critical ambiguous-local-state outcome; it never falsely
    claims the old identity is active.
15. Post-replacement obligations decompose into:
    a. given successful replacement, the command reloads/revalidates the
       canonical candidate, re-verifies backup bytes/metadata, and retains the
       backup until explicit root cleanup;
    b. the old remote device is never deleted automatically;
    c. backup cleanup is allowed only after spec 40's hardened `DeleteDevice`
       records deletion after processing every certificate issued to the old
       device;
    d. mandatory real-handler/Postgres tests (spec 40) use injected clocks and
       authoritative event fixtures to cover current, expired, not-yet-valid,
       and legacy missing-`NotBefore` histories;
    e. deployment E2E separately proves CRL HTTP rejection for a newly issued
       still-valid old certificate through the public route and every Gateway
       replica; synthetic certificate-time branches never substitute for that
       middleware proof.
16. Startup under attempt/backup state decomposes into:
    a. given a valid canonical identity plus a correlated attempt state
       (`prepared`, `invoking`, `returned`, or `staged`), that canonical
       identity remains the only runtime identity when the SQLite binding
       matches it;
    b. every attempt state blocks registration and every credential writer,
       including certificate rotation, so incumbent ciphertext and attempt
       hashes cannot drift before root performs the state-specific resume or
       abort;
    c. management runtime may continue with credential state read-only and an
       explicit recovery warning;
    d. a retained committed-replacement backup without an attempt row does not
       itself disable credential writers when canonical credentials and the
       SQLite binding agree;
    e. given canonical credentials are absent/invalid while an attempt or
       backup artifact exists, startup fails closed, does not open the
       mode-`0666` enrollment socket, and never automatically rolls back or
       retries a network operation.
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
19. Installer behavior decomposes into:
    a. given normal `install.sh` receives a token, syntax validation runs
       first, and class `2` is handled before any service stop;
    b. it records service activity, stops a previously active daemon, runs
       fd-anchored upgrade preparation plus root-only `credential-status`
       against the exact configured data directory, and acts only on the
       returned machine class — never on human text;
    c. a startable canonical identity is restarted unchanged and the token is
       reported unused;
    d. confirmed absence proceeds to ordinary enrollment;
    e. any correlated interrupted attempt or invalid/indeterminate state
       performs no registration and follows its specified safe restart/stop
       result;
    f. explicit `--reenroll` first completes the same ordinary
       upgrade/migration phase when the installed state predates this spec, but
       the strict reenrollment command never calls path-based
       `create_directories` or repairs metadata;
    g. `--reenroll` requires `--token-file`, forwards the one resolved
       `--data-dir`, starts the candidate on `0`, restarts the incumbent only
       on `10`/`11`/`13`, and leaves the service stopped on `12`/`14` or
       unclassified interruption.
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
22. *(Split 2026-07-18.)* The shared per-device lifecycle lock, DER-derived
    certificate authority events, retention exemptions, and the
    revoke-before-delete `DeleteDevice` contract are specified as atomic
    criteria in spec 40 (its ACs 1–12). This spec consumes them: AC 15c's
    backup-cleanup precondition and the old-device deletion flow depend on
    spec 40 being active.
23. Identity retirement decomposes into:
    a. given a populated agent store bound to the old device ULID, one SQLite
       transaction deletes every server-authored scheduler/action/work/result
       row, maintenance window, and persisted LPS public key classified as
       management-identity-bound, then updates the binding to the new ULID;
    b. explicitly classified machine-local LUKS/LPS history and local-admin
       settings are preserved, and no cleanup callback executes;
    c. a self-discovering exact registry with a matches-zero guard prevents a
       new table or setting key from bypassing classification;
    d. runtime sends or dispatches nothing until the binding equals canonical
       credentials.
24. Post-registration crash recovery decomposes into:
    a. given a crash after successful registration but before the active
       rename, the exact journal/file tuple determines recovery — never a
       heuristic;
    b. `returned` without a verified `credentials.enc.next` cannot resume and
       requires confirmed-remote abort/cleanup;
    c. a durable verified next plus any partial/complete backup state is
       `staged`, not corrupt, and may resume without another network call or
       explicitly abort;
    d. either operation proves canonical incumbent bytes, salt, and store
       binding unchanged, is lease-held/fd-anchored/durable, and reports the
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
27. *(Split 2026-07-18.)* Serialized token admission and the atomic
    `TokenConsumed` + `DeviceRegistered` batch are specified as atomic criteria
    in spec 40 (its ACs 13–17). Reenrollment's single-invocation contract
    (AC 7) presumes that server behavior but does not depend on it for local
    safety: every local guarantee here holds against the current server too.
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
31. Backup cleanup decomposes into:
    a. given root invokes `reenroll cleanup-backup` after the candidate has
       recorded a successful connection, the command requires the exact old
       ULID plus an explicit acknowledgement that an administrator's hardened
       `DeleteDevice` (spec 40) succeeded, validates the retained backup
       certificate, and removes backups only under the lease with durable
       fd-anchored operations;
    b. the delete-success acknowledgement is an operator attestation, not a
       verified fact — deliberately a **UX guard**. Its blast radius is bounded:
       cleanup deletes only local rollback material, and server-side
       `DeleteDevice` remains the sole revocation authority, so a false
       attestation cannot un-revoke anything;
    c. fleet-wide CRL enforcement and historical-certificate membership are
       release/deployment evidence, not unverifiable per-host live-probe
       prerequisites; missing proof or mismatch leaves every backup intact.
32. *(Split 2026-07-18.)* Server authority-model activation — including the
    **mechanical** database-level fence a legacy binary cannot write past
    (drain is hygiene, not the safety mechanism), stream-head installation, and
    the pre-traffic history scan — is specified in spec 40 (its ACs 18–20).
    Spec 40 lands and activates in production before this spec's agent artifact
    releases.

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
2. **server** — spec 40 (serialized token admission, device lifecycle
   authority, revoke-before-delete, mechanical activation fence). Split
   2026-07-18; reviewed and released independently, and active in production
   before this spec's agent artifact ships.
3. **agent** — configured-data-directory lifetime lease, anchored classified
   credential state at every registration entry point, management-identity-bound
   SQLite state and retirement, backup-aware replacement, exact
   incumbent/candidate validation, CLI/exit contract, installer wiring, metadata
   upgrade, startup fail-closed behavior, and real-agent E2E.
4. **docs** — installation, hard-CA replacement, remote-side-effect, rollback,
   old-device revocation, and backup cleanup procedures.

No protobuf change is required. The existing public `Register` RPC is invoked
exactly once. Spec 37's core harness, the spec 39 reviewed three-key manifest,
stable lane/readiness registry, and already-active `agent-socket` baseline land
first, and spec 40's server authority model activates before the agent artifact
ships; this spec supplies the credential-state fix and separate root-only lane.
The SDK/agent candidates are tested as one immutable change set through the
spec 37/39 gate. The agent artifact registers `offline-reenrollment-v1` only
together with complete `agent-reenrollment` scenarios, and no member is
released before the resulting manifest-triggered gate is green.

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

### Server authority model (split to spec 40)

The authoritative device lifecycle (shared per-device lock, DER-derived
certificate authority events, retention exemptions, revoke-before-delete
`DeleteDevice`) and serialized registration admission (per-token lock, event
replay, atomic `TokenConsumed` + `DeviceRegistered` batch), together with their
mechanical activation fence, are specified and tested in spec 40. This spec's
agent-side contracts consume those guarantees — the backup-cleanup
precondition (AC 15c, 31), old-device deletion evidence, and the assumption
that a lost registration response never half-commits token consumption — but
contain no server authority logic. Spec 40 is active in production before this
spec's agent artifact releases.

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

- **Server database:** spec 40 (stream heads, retention exemptions, new event
  types, replay helpers, per-key gates, append-guard fence, server ADR).
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
  reject replacement races. Server-side lifecycle/token serialization is
  spec 40's contract.
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
  `DeviceDeleted` (spec 40) provide immutable remote evidence, including
  revoke-success/delete-append-failure attempts. The local attempt row and
  command logs contain only safe states, hashes, validated ULIDs, and
  counts—never credential material.
- **Residual risk — revocation is per-certificate, not per-machine:** deleting
  and revoking the old device blocks every certificate ever issued to it, but
  nothing durably blocks the *machine*. An attacker with root on the device and
  possession of a valid registration token can rejoin as a new server-minted
  identity. This grants no privilege beyond what first enrollment already
  grants — and reenrollment is strictly more demanding (root plus the lease
  plus a structurally valid incumbent) — so it is accepted by design. Operators
  who need machine-level exclusion must withhold registration tokens; token
  admission control, not certificate revocation, is the machine-level boundary.
- **Residual risk — reenrollment is trust-on-first-use toward the new CA:** the
  candidate CA is adopted from the registration response, so a
  machine-in-the-middle holding the token could substitute its own CA. The
  optional `-ca-sha256` pin closes this, and a CA-replacement operator by
  definition has an out-of-band channel (the same one that carries the token)
  that can carry the fingerprint. **Recommendation, decision needed before
  implementation:** make `-ca-sha256` mandatory for `reenroll`, keeping TOFU
  only for ordinary first enrollment. Until decided, documentation and
  installer output must steer operators to always pass the pin.

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

### Server regression tests (split to spec 40)

The server registration, deletion, retention, race-matrix, fence, and
activation test suites are specified in spec 40. This spec's named
classification tests (AC 6b–6i) and every agent-side requirement below remain
here.

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
- Spec 37's core orchestration, the spec 39 manifest, stable lane/readiness
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
| Stat, permission, or I/O error while proving absence | `14`; fail closed, never unenrolled | Not unenrolled; explicit recovery required | Safe operation/basename/category; no bytes. Named tests: `TestReenroll_{Stat,Permission,IO}ErrorNotAbsence` (AC 6b–6d) |
| Decrypt, parse, or salt failure while proving absence | `14`; fail closed, never unenrolled | Not unenrolled; explicit recovery required | Safe category; no bytes. Named tests: `TestReenroll_{Decrypt,Parse,Salt}ErrorNotAbsence` (AC 6e–6g) |
| Identity/binding mismatch while proving absence | `14`; fail closed, never unenrolled | Not unenrolled; explicit recovery required | Validated ULIDs when available. Named tests: `TestReenroll_IdentityErrorNotAbsence` plus the daemon/socket entry-point matrix (AC 6h–6i) |
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
| Server-side token admission and device deletion rejections | *(Split 2026-07-18.)* See spec 40's rejection table | — | — |
| Successful replacement | `0` with different old/new ULIDs | Candidate bound/active; remote old identity and backups retained | Validated ULIDs, retired-row safe counts, success only |

## Rollout and migration

Land spec 37's core harness, the spec 39 reviewed three-key manifest, exact
lane/readiness registry, and complete active `agent-socket` baseline first.
Spec 40's server authority model (retention-safe token/lifecycle authority plus
its mechanical activation fence) lands, activates, and is verified in
production before this spec's agent artifact releases. Then merge the
compatible SDK component-walk/dirfd/URL/client limits and agent
lock/classifier/attempt/binding/CLI/installer work. Record the exact resulting
commit objects from those reviewed changes as `sdk_sha`, `server_sha`, and
`agent_sha`; never re-resolve a branch head or matching tag. Verify
release-branch reachability and that the server/agent dependency graphs resolve
the recorded `sdk_sha`, then rerun the complete gate. Descriptor fingerprints,
binary hashes, and image digests are recorded separately. Only that green
manifest-triggered gate may create repository tags/releases or promote the
tested OCI digests. No member releases early.

Server activation is fenced mechanically per spec 40: the activation migration
installs a database-level append guard that an un-drained legacy Control
replica cannot write past — it fails closed at the storage layer instead of
serving the legacy partial-commit path. Draining old replicas remains
operational hygiene, not the safety mechanism. The daemon participates in the
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
- Spec 39: release provenance and publication authority.
- Spec 40: serialized registration authority and device lifecycle (split from
  this spec 2026-07-18).

## Audit findings (2026-07-18)

Pre-implementation security review (the largest and highest-stakes spec). **The
design is sound: no Critical/High revocation-bypass or identity-takeover path.** The
ULID is server-minted, re-enrollment requires proving the prior local binding, the
candidate must differ from the incumbent, and a revoked cert never re-authorizes (it
is used only for local structural validation). It also **fixes three real current
weaknesses** — reason enough to implement it:

1. Revoke-*before*-delete over *all* historical fingerprints, `Internal` on failure
   (today `DeleteDevice` emits `DeviceDeleted` first, then best-effort revokes only
   the latest projected fingerprint — [device_handler.go:311-330](../../../server/internal/api/device_handler.go)
   — so a CRL-write failure or superseded renewal cert stays live to ~1-year expiry).
2. Atomic token-consume + device-register (today they are two non-atomic appends →
   orphan-consumed-token on partial failure).
3. Kills the enroll fall-through that replaces identity when `Exists()` is true but
   `Load()` fails ([agent enroll.go:147-157](../../../agent/internal/deviceauth/enroll.go)).

Blockers are quality/rollout, not design holes:
- **[Medium] Acceptance criteria are compound and non-atomic on a fleet-impersonation
  boundary.** ACs 1-32 bundle 5-10 separable guarantees each (AC 22 alone:
  lifecycle-lock ordering, DER-derived fingerprint/validity persistence, retention
  exemption, revoke-before-delete ordering, certless-delete replay,
  partial-metadata→Internal, retry). They can't map 1:1 to fail-closed tests, and on
  this boundary ambiguity *is* the risk. Fix: decompose into atomic, test-mapped
  criteria; add a rejection-table row + named `Test<Method>_<Scenario>` for every
  "…not classified as absence/unenrolled" edge.
- **[Medium] The rollout couples a security-critical HA event-sourcing migration
  (atomic token admission + per-device lifecycle lock + stop-the-world activation)
  with the agent re-enroll CLI behind an operationally-enforced drain.** A leaked
  fence (one un-drained legacy replica) re-exposes the legacy partial-commit path.
  Fix: split the server token-admission / lifecycle-lock migration into its own
  spec/PR reviewed and gated independently; make the fence mechanically enforced
  (schema/flag gate the legacy binary refuses to serve past), not drain-only.
- **[Low] Add two residual-risk paragraphs to Security considerations:** (a) revocation
  is per-certificate, not a durable per-machine block — an attacker with root + a
  valid token can rejoin as a *new* server-minted identity (no privilege gain over
  first-enroll, which is less restrictive); (b) re-enroll deliberately adopts a new CA
  (TOFU), so consider making `-ca-sha256` **mandatory** for re-enroll since a
  CA-replacement operator has an out-of-band fingerprint channel.
- **[Low] `cleanup-backup --acknowledge-delete-device-success` trusts an operator
  attestation, not a verified fact** — bounded (deletes only local rollback material;
  server-side `DeleteDevice` is the sole revocation authority). Document that it is a
  UX guard.

Guarantee check: revocation **preserved and improved**; device-identity **preserved**
(no takeover, no cross-device secret pull).

### Remediation (2026-07-18, WS-E amendment)

- **Compound ACs (Medium)** → the compound criteria on the classification and
  replacement boundary (ACs 1, 6, 7, 9, 13, 15, 16, 19, 23, 24, 31) are
  decomposed into lettered atomic sub-criteria; every "…not classified as
  absence/unenrolled" edge now carries a named mandatory test
  (`Test<EntryPoint>_<Error>NotAbsence`, AC 6b–6i) and its own rejection-table
  row. The remaining numbered ACs each state a single guarantee as written.
- **Coupled HA migration (Medium)** → the server-side serialized token
  admission, per-device lifecycle lock, revoke-before-delete, and activation
  moved to spec 40 (user decision 2026-07-18), reviewed and released
  independently and active before this spec's agent artifact. Old ACs 22/27/32
  are split pointers. Spec 40's activation fence is **mechanical** — a
  database-level append guard bound to a per-connection capability declaration
  that a legacy binary cannot satisfy — not drain-only.
- **Residual risks (Low)** → two Security-considerations paragraphs added:
  revocation is per-certificate not per-machine (token admission is the
  machine-level boundary, accepted by design), and reenrollment is TOFU toward
  the new CA with the recommendation — decision needed before implementation —
  to make `-ca-sha256` mandatory for `reenroll`.
- **`cleanup-backup` attestation (Low)** → AC 31b documents the delete-success
  acknowledgement as a UX guard bounded to local rollback material; server-side
  `DeleteDevice` remains the sole revocation authority.
