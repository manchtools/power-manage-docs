---
title: Global search
---
# Global search

The Search RPC serves global search and the ten scoped entity facets. Search
documents are derived data and never authoritative state.

## Engine

Search uses SQLite FTS5. Index updates commit in the same transaction as the
owning CRUD row, so a successful mutation is immediately reflected and erasure
removes searchable personal data atomically.

FTS5's trigram tokenizer retrieves candidates only; one bounded application
matcher makes the final accept/reject and ordering decision, so search behavior
does not depend on engine-specific ranking.

## Contract

- Unicode-aware, case-insensitive prefix matching with a one-character floor
- punctuation-heavy hostnames, emails, dotted identifiers, German text, and
  the existing `ß`/`ss` behavior
- current filter and authorization scopes without exposing internal scope IDs
- deterministic per-facet ordering and pagination
- 50 default and 200 maximum results per page

Typo tolerance is bounded per query token. Tokens shorter than four characters
must match exactly or by prefix, tokens of four to seven characters tolerate one
edit, and longer tokens tolerate two. Insertion, deletion, substitution and
adjacent transposition each cost one edit.

Exact and prefix hits always precede fuzzy-only hits. Fuzzy-only hits order by
total edit cost, then by which field matched, then by entity ID, so pagination
stays deterministic across the combined result set.
