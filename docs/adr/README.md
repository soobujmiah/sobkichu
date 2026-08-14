# Architecture Decision Records

Decisions that shape the system, with their trade-offs, recorded at the time they were made. An ADR explains *why*; the other docs explain *what* and *how*. If you catch yourself justifying a rejected alternative inside a how-to doc, write an ADR instead.

## Format

Each ADR is short and has: **Context → Decision → Consequences → Alternatives rejected**. Status is `Accepted`, `Superseded by ADR-XXXX`, or `Proposed`.

## When you need one

- Departing from the locked stack (master prompt §3) — this is mandatory, and the deviation must be stated explicitly
- Introducing a new NFR trade-off
- Choosing between two viable designs where the loser has real merit
- Anything touching payment holding, user value, or content moderation

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-modular-monolith.md) | Modular monolith for Phase 1, not microservices | Accepted |
| [0003](0003-postgres-fts-before-search-engine.md) | Postgres full-text search before a search engine | Accepted |
| [0004](0004-payments-via-licensed-aggregator.md) | Payments via licensed aggregator, no custom wallet | Accepted |
| [0005](0005-compliance-in-schema.md) | Encode compliance rules in the schema, not the UI | Accepted |

## Next number

`0006`. Copy the shape of an existing one; don't invent a new template.
