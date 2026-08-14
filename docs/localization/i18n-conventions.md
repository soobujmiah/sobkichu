# i18n Conventions

**i18n and Bangla support are structural, not stylistic** (master prompt §10.7). Every user-facing string in generated code and schemas routes through a translation key. Not hardcoded English — and equally, not hardcoded Bangla.

## The rule

```dart
// Wrong — hardcoded English
Text('Order placed')

// Wrong — hardcoded Bangla. Same bug, different language.
Text('অর্ডার হয়েছে')

// Right
Text(t('order.status.placed'))
```

The failure mode people miss: hardcoding Bangla feels correct in a Bangla-first product, but it strands the English fallback and breaks the moment a string needs to vary.

## Key naming

```
<domain>.<entity>.<state|action|field>[.<qualifier>]
```

| Key | Use |
|---|---|
| `order.status.placed` | Order status label |
| `order.action.cancel` | Button label |
| `checkout.terms.refund_policy` | Legal text block (Bangla mandatory — compliance C6) |
| `merchant.onboarding.nid_upload.help` | Helper text |
| `error.network.offline_queued` | Error/state message |

Rules: lowercase snake within segments, domain first, no UI-position names (`screen2_label_top` tells a translator nothing), no abbreviations a translator cannot decode.

## Bundle layout

```
locales/
  bn/            # source of truth — write Bangla first
    order.json
    checkout.json
    merchant.json
  en/            # secondary
    order.json
    ...
```

Bangla is authored first because copy written in English and translated tends to produce stiff, formal Bangla that reads badly to the target user. Write it in Bangla, then render English.

## Non-negotiables

1. **Legal text must exist in `bn`.** Refund, return, delivery, and complaint terms without a Bangla translation are a compliance failure (DCOG 2021). CI fails the build if a key under `checkout.terms.*` or `legal.*` is missing from `bn`.
2. **No English fallback for legal text.** For ordinary UI, missing `bn` may fall back to `en` in development. For legal keys, missing `bn` blocks the merge — silently showing English terms to a Bangla speaker is exactly the thing the guideline prohibits.
3. **Server-stored text is keys or content pairs.** `order_status_event.note_key` holds a key, never a free-text English note. Merchant-authored content is stored as `*_bn` / `*_en` pairs (see `listing`).
4. **Numbers, dates, currency go through the locale formatter.** Bangla numerals and BDT (৳) formatting are not string concatenation.

## Bangla text handling

- **Fonts:** bundle a Bangla font with full conjunct coverage. Don't rely on the device font — many low-end Android devices render Bangla conjuncts badly or not at all.
- **Line breaking and truncation:** Bangla strings run longer than English equivalents. Design for ~1.3× the English length; never rely on a fixed-width label.
- **Input:** support both Bangla keyboard input and Latin-script Bangla ("banglish"), especially in search.

## Voice and search normalization

Voice search must handle Bangla with common code-switching. "bike mechanic amar area te" is a normal query.

The search normalization pipeline needs to handle, at minimum:

| Input form | Example |
|---|---|
| Bangla script | বাইক মেকানিক |
| Latin-script Bangla | baik mekanik / bike mechanic |
| Mixed | bike mechanic amar area te |
| Phonetic variants | mekanik / mechanic / mekhanik |

Phase 1 approach: Postgres full-text with a `simple` configuration plus a transliteration/synonym layer at query time, indexing both scripts. This is deliberately not a search engine — Postgres FTS holds until Phase 2+ justifies the ops overhead ([ADR-0003](../adr/0003-postgres-fts-before-search-engine.md)).

## Review checklist

- [ ] No hardcoded user-facing string in either language
- [ ] Every new key present in `bn`; legal keys present in `bn` or the build fails
- [ ] Bangla authored by or reviewed by a native speaker — not machine-translated into production
- [ ] Layout checked with Bangla strings, not English placeholders
- [ ] Numbers, dates, and currency locale-formatted
