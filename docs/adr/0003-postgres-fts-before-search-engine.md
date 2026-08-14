# ADR-0003: Postgres full-text search before a dedicated search engine

**Status:** Accepted
**Date:** 2026-08-14

## Context

Discovery is the core of the product, and the search requirement is non-trivial: Bangla script, Latin-script Bangla ("banglish"), code-switched queries like "bike mechanic amar area te", and phonetic spelling variation — combined with a geo radius filter.

That combination is exactly the argument people use for reaching straight for Elasticsearch or Meilisearch. The master prompt pre-empts it: **Postgres full-text to start; do not introduce Elasticsearch/Meilisearch until Phase 2+ justifies the ops overhead** (§3).

## Decision

Phase 1 search is **PostgreSQL full-text** — a `tsvector` column on `listing` maintained by trigger, GIN-indexed, combined with a PostGIS `ST_DWithin` radius filter in the same query.

Bangla handling is done at the application layer, not by swapping the engine:

- `simple` text search configuration (no stemmer assumes English)
- Index both Bangla-script and Latin-script forms of title and description
- Query-time transliteration and a synonym layer for common phonetic variants
- Code-switched queries tokenised and matched against both indexed forms

## Consequences

**Good:**

- The geo filter and the text filter run in one query against one system. With an external engine, geo-filtering and text-ranking live in different places and must be reconciled — usually badly, and always with an extra network hop on the hottest path.
- No index-sync pipeline, no second datastore to keep alive, no split-brain between Postgres and a search index.
- One fewer service to operate for a team that does not have search-ops capacity.

**Bad, accepted:**

- Ranking quality is worse than a purpose-built engine. Typo tolerance in particular is weak — Postgres FTS has no built-in fuzzy matching, so `pg_trgm` similarity is the fallback.
- The transliteration/synonym layer is our code to maintain, and it will need tuning against real query logs.
- Faceting and complex relevance tuning are painful.

**Revisit when** (any of these, in Phase 2+):

- Query latency on the radius+text path exceeds budget under real load
- Query logs show typo-driven zero-result rates that trigram matching cannot fix
- Faceted filtering becomes a product requirement rather than a nice-to-have

At that point, Meilisearch is the likelier candidate than Elasticsearch — lighter to operate, and adequate for a single-city catalog.

## Alternatives rejected

**Elasticsearch now.** Best-in-class relevance, and the heaviest ops burden of the options — a cluster to run, an index-sync pipeline to keep correct, and JVM memory tuning. Unjustified for a single-city Phase 1 catalog.

**Meilisearch now.** Much lighter, genuinely good typo tolerance. Still a second datastore with a sync pipeline, and still splits geo from text. Deferred, not dismissed — it is the designated upgrade path.

**Naive `ILIKE '%query%'`.** No ranking, no index usage for leading wildcards, degrades immediately. Not a serious option even for an MVP.
