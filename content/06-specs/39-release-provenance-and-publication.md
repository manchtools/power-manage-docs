---
title: "Release provenance and publication authority"
status: draft
created: 2026-07-18
---

# Release provenance and publication authority

## Overview

Define the reviewed change-set manifest, single-build binary/image provenance,
and digest-ledger publication authority for Power Manage releases. Split from
spec 37 on 2026-07-18 (its former ACs 17/18): spec 37 owns the exhaustive
deployed-execution gate; this spec owns what that gate runs against and what a
green result authorizes. The green manifest-triggered gate — never a
pre-existing `v*` tag — is the only actor allowed to create repository
tags/releases or promote OCI tags.

## Motivation

`release.yml` today has provenance gaps the E2E gate cannot close by itself:
server CI can silently substitute a matching SDK tag or branch default for the
reviewed SDK; per-service floating-alias pushes are not atomic, so a partial
failure leaves a mixed fleet under `latest`; the GitHub Release is created
non-draft before images verify; and arm64 images publish untested. A release
must be traceable to exactly the reviewed sources, built once, tested as the
exact bytes that publish, and never authorized by a mutable ref.

## Acceptance criteria

1. Given a PR or coordinated clean-break candidate changing SDK,
   server/deploy/E2E, or agent, when its reviewed change-set manifest is
   created, then it records exactly three Git identities — `sdk_sha`,
   `server_sha`, `agent_sha` — and nothing else as a repository identity.
   Generated clients are part of `sdk_sha`; deploy scripts, Compose, workflows,
   and E2E source are part of `server_sha`. A fourth SHA, a missing key, or a
   digest/fingerprint recorded as a SHA fails CI.
2. Given the manifest's non-identity metadata, then it owns exactly one
   `stable` or `prerelease` channel field; no repository infers the channel
   independently from tag spelling.
3. Given candidate CI, when the manifest is validated, then current-source
   amd64 binaries/images are built from that immutable candidate set, server
   and agent dependency graphs are verified to resolve the recorded `sdk_sha`,
   and CI never substitutes a branch, matching tag, or published default. A
   coordinated clean break supplies all three candidates so no member is tested
   against an old incompatible default.
4. Given each coordinated change has merged, when the release manifest is
   finalized, then the coordinator records the exact resulting commit object
   for each reviewed change; release CI never re-resolves ambient branch heads.
   Reachability from the configured release branches and SDK dependency
   resolution are verified before the complete spec 37 gate reruns. A changed
   SHA invalidates the manifest and requires a new review plus a full rerun.
5. Given a release build, then each service/architecture binary is built
   exactly once, hashed, and attested, and those exact bytes are both the OCI
   image input and the GitHub Release binary asset. Each OCI image is built
   exactly once under a run-scoped staging reference; its registry digest is
   captured, and every later test, arm64 boot probe, provenance, and
   publication step addresses `repository@sha256:…`, never a tag.
6. Given publication, then it is authorized only by a green manifest-triggered
   run of the spec 37 exhaustive suite (amd64) plus an arm64 boot probe against
   the exact captured digests, with spec 37's execution-completeness guard
   passing. A green result on a mutable PR head authorizes nothing.
7. Given repository tags, then each Git tag dereferences to its own
   repository's SHA (`sdk_sha`, `server_sha`, or `agent_sha`; tag names need
   not match across repositories), and OCI tags point only to tested manifest
   digests whose provenance records all applicable Git identities. Descriptor
   fingerprints, binary hashes, and image digests are non-Git identities and
   never masquerade as repository SHAs.
8. Given a server release unit, when publication runs, then CI first creates
   the GitHub Release as a **draft** containing the matching deploy tree,
   original binaries, checksums, reviewed change-set manifest, digest ledger,
   and provenance; then publishes and verifies immutable
   control/gateway/indexer version manifests; then records each prior
   floating-alias digest before updating `latest` or `latest-rc` per service;
   then verifies every alias against the reviewed digest ledger. The Release
   becomes public only after every immutable manifest and every intended alias
   verifies.
9. Given registry alias updates cannot be atomic across services, when any
   alias update or verification fails, then CI restores every changed alias to
   its recorded prior digest best-effort, keeps the GitHub Release draft, and
   reports any incomplete rollback as a publication incident. Floating aliases
   are convenience pointers only; the reviewed digest ledger remains the
   publication authority.
10. Given the manually operated `deploy.sh` path, then it is explicitly
    non-release: local builds use a source-derived
    `dev-<server_sha>-<sdk_sha>-<arch>` identity and a temporary deployment
    override, never a released version, `latest`, `latest-rc`, or the
    operator's persisted `IMAGE_TAG`.
11. Given any failed manifest, build, gate, or publication step, then complete
    redacted artifacts are preserved; secrets, `.env`, private keys, tokens,
    and raw secret-bearing payloads are never uploaded.

## Out of scope

- The deployed E2E scenarios, registries, ledgers, and guards themselves —
  spec 37 owns the gate; this spec owns its inputs and what green authorizes.
- Web, docs, and marketplace release processes (separate repos, unchanged).

## Technical design

### Affected repositories

- `server/.github/workflows/release.yml` and the coordinator tooling — manifest
  validation, single-build/attestation, digest ledger, publication ordering.
- `server/deploy/` — `deploy.sh` non-release identity, version manifests.
- `sdk/`, `agent/` — tag mapping and dependency-resolution verification only.

### Change-set manifest

The reviewed change-set manifest contains exactly three Git identities:
`sdk_sha`, `server_sha`, and `agent_sha`. SDK-generated clients belong to
`sdk_sha`; Compose, deploy scripts, workflows, and E2E source belong to
`server_sha`. Descriptor fingerprints, binary hashes, image digests, and
provenance attestations are separate non-Git identities and never masquerade as
repository SHAs. Non-identity metadata includes one manifest-owned `stable` or
`prerelease` channel so repositories do not infer channel independently from
tag spelling.

An ordinary PR uses a reviewed compatible candidate set. A coordinated clean
break supplies all three candidates so no member is tested against an old
incompatible default. PR CI runs spec 37's offline exactness plus
current-source amd64 E2E from that recorded set. After each coordinated merge,
the coordinator records the exact resulting commit object for that reviewed
change; release CI never resolves a mutable branch or matching tag. It verifies
each commit is reachable from the configured release branch and that
server/agent dependency graphs resolve `sdk_sha`, then reruns the complete
gate. A changed SHA invalidates the manifest and requires review plus a full
rerun.

### Single-build provenance

Each service/architecture binary is built exactly once, hashed, and attested.
Those exact bytes are both the OCI image input and the GitHub Release binary
asset. Each OCI image is built exactly once under a run-scoped staging
reference; its registry digest is captured and all E2E, arm64 boot, provenance,
and publication steps use `repository@sha256:…`. Version and floating manifests
contain only those tested digests. Server Git tags/releases dereference to
`server_sha`, agent tags to `agent_sha`, and both SDK Go-module/calendar tags
to `sdk_sha`; tag names need not match across repositories. OCI tags point to
tested digests whose provenance records the Git identities.

### Publication ordering and rollback

The green manifest-triggered final gate — not a pre-existing release tag — is
the sole publication authority. For a server release unit, CI first creates the
server GitHub Release as a **draft** with the matching deploy tree, original
binaries, checksums, reviewed change-set manifest, digest ledger, and
provenance. It then publishes and verifies immutable control/gateway/indexer
version manifests. Before changing floating aliases it records each prior alias
digest; it updates `latest` or `latest-rc` per service, then verifies every
alias against the reviewed digest ledger. Registry operations cannot make three
aliases atomic. If any update or verification fails, CI attempts to restore
every changed alias to its recorded prior digest, keeps the GitHub Release
draft, and reports any incomplete rollback as a publication incident. Floating
aliases are convenience pointers only; the reviewed digest ledger remains
authoritative. CI publishes the GitHub Release only after all immutable
manifests and intended aliases verify. The manually operated `deploy.sh` path
is explicitly non-release: local builds use a source-derived
`dev-<server_sha>-<sdk_sha>-<arch>` identity and a temporary deployment
override, never a released version, `latest`, `latest-rc`, or the operator's
persisted `IMAGE_TAG`. Preserve complete redacted artifacts on failure.

## Security considerations

- Publication authority is a verified digest ledger, not a mutable tag or
  branch head; a compromised or mistaken tag push cannot publish.
- Attestation binds released bytes to reviewed Git identities; a substituted
  SDK or image is detectable from provenance alone.
- Partial-alias rollback fails closed (Release stays draft) rather than
  leaving a silently mixed fleet presented as released.
- Redaction rules for failure artifacts match spec 37 AC 19.

## Test requirements

Workflow-level tests (runnable against a scratch registry/repo, red-checked):

- Manifest identity: a fourth SHA, a missing key, and a digest recorded as a
  SHA each fail validation (AC 1); channel inference from tag spelling fails
  (AC 2).
- Substitution red check: a matching SDK tag exists but differs from the
  recorded `sdk_sha` — the build must fail rather than substitute (AC 3).
- Post-merge identity: a re-resolved branch head, unreachable SHA, and
  dependency graph not resolving `sdk_sha` each block the rerun (AC 4).
- Single-build/digest pinning: any test or publication step addressing a tag
  instead of the captured digest fails; Release asset bytes hash-match the
  attested build (AC 5, 7).
- Publication ordering: a tag-triggered publish attempt without the manifest
  gate is refused; the Release remains draft until every manifest and alias
  verifies (AC 6, 8).
- Injected partial-alias failure: one alias update fails after another
  succeeded — changed aliases are restored to captured prior digests, the
  Release stays draft, and incomplete rollback surfaces as an incident (AC 9).
- Manual-deploy identity: `deploy.sh` produces the `dev-…` identity and never
  touches released tags or the operator's persisted `IMAGE_TAG` (AC 10).
- Failure-artifact redaction detector blocks secret material (AC 11).

Spec 37's startup ledger asserts the consumer side: the booted stack's
identities match the recorded candidate set.

## Rejection paths

| Scenario | Error code | Client-visible message | Logged context |
|----------|------------|------------------------|----------------|
| Change-set manifest has a fourth Git SHA, omits one of the three keys, or confuses a digest/fingerprint with a SHA | CI identity failure | Invalid `sdk_sha`/`server_sha`/`agent_sha` manifest | Exact key/category and safe observed identity |
| Recorded merged SHA is changed, unreachable, re-resolved from a mutable ref, or dependency graph does not resolve `sdk_sha` | CI provenance failure | Reviewed source set invalid; release blocked | Expected and observed immutable identities/dependency result |
| A tag-triggered path publishes before the manifest gate, a Git tag targets the wrong repository SHA, or an OCI tag references an untested digest | CI publication failure | Publication identity/order mismatch; GitHub Release remains draft | Repository, tag/channel, expected SHA/digest, safe observed identity |
| Floating alias update/verification fails after another service alias changed | CI publication failure plus rollback attempt | Release remains draft; changed aliases are restored to captured prior digests where possible, and incomplete rollback is an incident | Service alias, prior/target/observed digest, rollback status; reviewed digest ledger remains authoritative |
| Spec 37 gate (amd64 exhaustive or arm64 boot) is not green against the captured digests | CI publication failure | Release precondition not met | Manifest identities, digest set, failing gate |
| Diagnostic artifact contains secret material | CI redaction failure | Artifact publication blocked | Artifact path and detector category, never the secret value |

## Rollout and migration

Land the manifest schema, validation, and candidate-identity consumption
together with spec 37's phase one (its startup ledger consumes the manifest).
Single-build provenance and digest pinning can land next, replacing the current
tag-addressed release steps. Publication authority (draft-first ordering, alias
rollback, tag-trigger refusal) activates last, in the same candidate that makes
spec 37's exhaustive suite release-blocking — until then the existing
`release.yml` path remains authoritative and this workflow runs in
report-only mode.

## References

- Spec 37 — exhaustive deployment E2E gate (this spec's sole gate consumer)
- `server/.github/workflows/release.yml`
- `server/deploy/deploy.sh`, `server/deploy/compose.yml`
- Image tag contract: `:latest` stable, `:latest-rc` pre-release
