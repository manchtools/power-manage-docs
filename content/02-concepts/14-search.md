---
title: Global search
---
# Global search

The Search RPC serves global search and the ten scoped entity facets. Search
documents are derived data and never authoritative state.

## Consolidation engine

During consolidation, search uses PostgreSQL full-text search. Index updates
commit in the same transaction as the owning CRUD row, so a successful
mutation is immediately reflected and erasure removes searchable personal data
atomically.

FTS5 replaces PostgreSQL FTS only during the final SQLite port. The engine
change must not alter the RPC or observable search behavior.

## Contract

- Unicode-aware, case-insensitive prefix matching with a one-character floor
- punctuation-heavy hostnames, emails, dotted identifiers, German text, and
  the existing `ß`/`ss` behavior
- current filter and authorization scopes without exposing internal scope IDs
- deterministic per-facet ordering and pagination
- 50 default and 200 maximum results per page

Typo-tolerant matching is required, but its threshold and ordering relative to
prefix hits still need a small corpus-based acceptance decision. Do not hide
that decision behind a database-specific extension.
