# Accessibility & Low-Literacy UX Baseline

**This is a design constraint, not a polish layer.** A meaningful share of the target user base has low text literacy in Bangla and/or English, and limited experience with apps beyond a handful of daily-use ones.

**It applies to every role.** Merchant onboarding gets the same treatment as customer checkout. Rider and professional flows too, when they arrive. A merchant is not automatically a sophisticated user because they run a business.

This is **related to but distinct from** the Bangla-first requirement. A screen can be perfectly translated and still be unusable if it is paragraph-heavy. Check both, separately.

## The baseline

### 1. Icon/pictogram-first navigation

A user must be able to complete the core loop — browse, order, track, pay — by recognising pictures, not by reading instructions.

- Every primary action has a distinct, concrete pictogram (a rickshaw, a shop, a taka note), not an abstract glyph
- Category browsing is visual before it is textual
- Test: cover the labels. Can a first-time user still find "my orders"?

### 2. Minimal text density on primary screens

Where text is unavoidable: short, concrete sentences. Not abstract UI jargon.

| Don't | Do |
|---|---|
| "Your transaction is being processed and confirmation is pending" | "Payment sent. Waiting for the shop." |
| "Authentication required to proceed" | "Enter the code we sent by SMS." |
| "No results matched your query parameters" | "Nothing found nearby. Try a bigger area." |

Reviewer heuristic: if a primary screen has a paragraph, it has a bug.

### 3. Voice as a first-class input

Bangla voice search and commands, with the code-switching people actually use ("bike mechanic amar area te"). Reachable **from the main screen**, not buried in settings. A microphone affordance that is one tap from the home screen, visible without scrolling.

### 4. Large touch targets, high contrast

Accounts for older users, small and basic screens, and users unfamiliar with precise tapping.

- Minimum 48×48 dp touch targets on all interactive elements; 56 dp for primary actions
- Adjacent destructive and confirming actions must not be adjacent — separate cancel from confirm
- Contrast tested at outdoor-daylight brightness, not just in a dark office

### 5. Visual and audio confirmation at every critical step

Order placed, payment received, rider arriving. Never rely on the user correctly reading and interpreting a status string.

- A distinct sound plus a distinct full-screen visual state for each critical confirmation
- Confirmation states are recognisable at a glance and by colour+shape, not colour alone
- The lightest possible animation that does the job — see the device budget below

### 6. Don't assume familiarity with app conventions

Hamburger menus, icon-only buttons, and swipe gestures are learned conventions, not universal ones.

- Label on first encounter, then let the icon carry it afterwards
- No functionality that is *only* reachable by a gesture — a gesture may be a shortcut, never the sole path
- No hamburger menu holding a primary flow

## Interaction with the low-end device budget

Accessibility affordances must not blow the performance target (~2GB RAM Android devices, master prompt §8). Animation and audio choices interact directly:

- Prefer lightweight vector loops over heavy Lottie/Rive compositions, especially on list-heavy screens
- Confirmation animations are one-shot and short, not looping in the background
- Audio cues are short bundled clips, not streamed

A confirmation animation that janks on a 2GB device is worse than no animation: it reads as a failure to a user who is already unsure whether their order went through.

## Review checklist

Use this on every UI/UX-facing PR, for every role:

- [ ] Core loop completable by icon recognition alone
- [ ] No paragraph text on a primary screen
- [ ] Voice input reachable from the main screen (where the flow supports search)
- [ ] Touch targets ≥48 dp; primary actions ≥56 dp
- [ ] Every critical step has a visual **and** audio confirmation
- [ ] No gesture-only or hamburger-only path to a primary flow
- [ ] All strings via translation keys; Bangla present and reviewed by a native speaker
- [ ] Checked on a low-end profile — **not** signed off on the Redmi Turbo 4 Pro alone ([testing strategy](../workflow/testing-strategy.md))
