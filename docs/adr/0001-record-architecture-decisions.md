# ADR-0001: Record architecture decisions

**Status:** Accepted
**Date:** 2026-08-14

## Context

The master prompt locks a tech stack and a set of constraints, and explicitly requires that any deviation be **stated explicitly rather than silently substituted** (§3, §10.5). It also warns against drifting between alternatives across sessions.

Without a written record, that drift is invisible. Six weeks later nobody remembers whether Postgres FTS was a considered decision or an unexamined default, and the argument is re-litigated from scratch — or worse, quietly reversed in a PR.

This matters more than usual here because much of the design work is produced by an AI across separate sessions with no memory between them. The repo has to carry the reasoning.

## Decision

Record significant architecture decisions as ADRs in `docs/adr/`, numbered sequentially, in the format: Context → Decision → Consequences → Alternatives rejected.

An ADR is required when:

- Departing from the locked stack (mandatory)
- Introducing a new non-functional trade-off
- Choosing between viable designs where the rejected one has real merit
- Touching payment holding, customer value, or content moderation

ADRs are immutable once accepted. A reversal is a new ADR that supersedes the old one; the original stays in place with its status updated.

## Consequences

- The "state deviations explicitly" rule has somewhere to be satisfied concretely
- New contributors — human or AI — can read why, not just what
- Slight friction on significant decisions. That is the point; the friction is proportional to the decision
- Immutability means the record shows how thinking changed, which is often the useful part

## Alternatives rejected

**Decisions in PR descriptions.** They exist, but they are unfindable six months later and invisible to anyone reading the repo fresh.

**A single DECISIONS.md.** Becomes an unordered pile, and gets edited in place — which destroys exactly the historical record we want.

**No record.** The default, and the reason drift happens.
