# ADR-0002: Modular monolith for Phase 1, not microservices

**Status:** Accepted
**Date:** 2026-08-14

## Context

The product spans five eventual roles (Customer, Merchant, Rider, Professional, Community) across four phases. That breadth invites an early microservices split — one service per role or per domain.

The Phase 1 scale target is explicit: **single-city concurrent load, tens of thousands of DAU** (master prompt §8), with a matching instruction not to over-engineer for a scale that does not exist, because "that's tech debt, not future-proofing."

There is also a hard consistency requirement: Order and Transaction state changes must be transactional and can never desync, especially under COD-to-digital reconciliation.

## Decision

Phase 1 ships a **modular monolith** — one NestJS application, strict module boundaries per domain (`identity`, `catalog`, `order`, `payment`, `notification`, plus flag-gated seams for `dispatch`, `ledger`, `community`), one PostgreSQL primary, one Redis.

Module boundaries are drawn as if the modules were separate services: no cross-module database access, communication through module interfaces only. Extraction later is a move, not a rewrite.

## Consequences

**Good:**

- Order + Transaction atomicity is a local database transaction. In a split payment/order service it would need a saga, compensating transactions, and reconciliation logic — machinery whose only purpose is undoing a split we chose voluntarily.
- One deploy, one log stream, one place to debug. Meaningful for a small team.
- No inter-service network failure modes on the critical order path.

**Bad, accepted:**

- Whole-app deploys; a mobile-facing change redeploys the payment code
- Scaling is vertical plus horizontal replicas of the whole app, not per-domain
- Module boundaries must be enforced by review discipline, since nothing physical prevents a cross-module import. Lint rules for import boundaries help and should be added.

**Revisit when:** a single domain's load genuinely diverges (Phase 2 dispatch is the likely first candidate — it is latency-sensitive and bursty in a way catalog browsing is not), or the team grows past the point where one deploy pipeline is a bottleneck.

## Alternatives rejected

**Microservices per role.** Would impose distributed transactions on the exact flow that must not desync, at a scale that does not need it. The consistency requirement alone rules it out for Phase 1.

**Serverless functions.** Cold starts hurt on the discovery path, PostGIS connection management gets awkward, and it fits poorly with NestJS's module model.

**Monolith with no internal boundaries.** Cheapest now, but Phase 2 dispatch extraction becomes a rewrite. The boundaries cost little to maintain and preserve the option.
