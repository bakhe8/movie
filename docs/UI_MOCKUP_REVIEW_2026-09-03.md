# UI Mockup Review — «بصمة الذوق السينمائي» (`basamat_aldawq.html`)

**Date**: 2026-09-03 · **Artifact**: `basamat_aldawq.html` (external, not in the repository; 565 lines; one file with React 18 UMD, Babel standalone and the Tailwind Play CDN; four screens; Arabic RTL; Tajawal) · **Reviewed against**: blueprint v1.1, [SPECIFICATION.md](SPECIFICATION.md) §5, [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md), [DATA_LICENSING.md](DATA_LICENSING.md), [API.md](API.md).
**Method**: full read of the file; then served from a local static server and rendered in the in-app browser at 375×812 with mobile/touch emulation; all four tabs screenshotted; touch drag-reorder attempted on the triad screen; broken-image scan over `document.images`; resource timing read. Line numbers below (`L…`) refer to the mockup file.
**Purpose**: decide what of the mockup enters the real frontend (`apps/frontend`, Next 16 + React 19 + Tailwind 4) and record the two blueprint clarifications the review produced (§5). This document is a review, not a contract: the rules it cites live in the blueprint, SPECIFICATION §5 and the ADRs.

---

## 1. Verdict

| Axis | Verdict | Deciding reason |
|---|---|---|
| Look and feel | good | poster cards with a dark gradient overlay are the strongest element; consistent radius, toast, bottom nav |
| Product conformance | weak | percentages and a post-watch expectation question — both forbidden (`BP §7.2`, `§4.4`, `§4.5`, ADR-4) |
| Engineering / performance | not a base to build on | HTML5 drag does not work on touch; development builds and an in-browser compiler |
| Accessibility | weak | 8.5–10 px labels, small tap targets, emoji as icons |

**Decision**: keep the *visual intent* of the three-track list, the four-value row, the poster card and the radar; take **no code** from the file; rebuild the screens in `apps/frontend` under SPECIFICATION §5 with the corrections in §3–§4 below.

---

## 2. Verified results

| Check | Result |
|---|---|
| Render at 375×812 (touch emulation), all four tabs | renders; no console errors |
| Touch drag of card 1 onto card 2 (triad screen) | order unchanged (ذيب، كفرناحوم، شمس المعارف); the drag hung the renderer for 30 s and pointer clicks timed out until reload |
| Broken images | 1 of 7 Unsplash URLs fails (`photo-1605814510652…`, used for "Parasite" on two screens); the alt text renders inside the card, no fallback |
| Fonts | Tajawal, 8 woff2 files, ≈ 77 KB total |
| Scripts | React 18 *development* builds, Babel standalone, Tailwind Play CDN (all three documented by their vendors as not for production; cross-origin sizes not exposed by timing headers) |
| `DOMContentLoaded` | ≈ 460 ms on localhost, before Babel compiles the JSX |

---

## 3. What to keep (maps to the blueprint)

| Element | Mockup | Blueprint anchor |
|---|---|---|
| Three tracks: اختيار آمن · اكتشاف محسوب · خارج المعتاد | `L110`–`L132`, `RECS` | `BP §4.4`, ADR-8 — exact match |
| Four separate values per recommendation (fit, public quality, availability, confidence) | `L408`–`L420` | `BP §2.4 #7`, `§4.4`, ADR-20 — the structure is right; the *formats* are not (§4 below) |
| Verbal confidence badge «ثقة متوسطة» on the taste-profile screen | `L289`–`L291` | `BP §9.3` — the correct pattern, applied on one screen only |
| Radar + strength-tiered tags as the profile's visual identity | `L144`–`L151`, `L262`–`L266` | `BP §5.3` "ملف الذوق"; labels are a display selection (V1 has 13 keys — [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md) §2; «المكافأة» and «التجريب» are not V1 keys) |
| Poster card with dark gradient, reason text, meta line | `L378`–`L392` | `BP §4.4` "سبب قوي" |
| Arabic-first RTL, `dir="rtl"`, Tajawal, bottom navigation, toast | `L2`, `L12`, `L524`–`L557` | `BP §5.1` |
| Progress «ثلاثية ٣ من ٥» | `L199` | SPECIFICATION §5.1 step 4 (3–5 seed triads) |

---

## 4. Findings

Severity: **H** = contradicts a `BP §2.4` principle or an ADR, or breaks the core interaction · **M** = must change before the screen ships · **L** = hygiene.

### 4.1 Blueprint and specification violations

| # | Sev | Mockup | What it shows | Rule | Fix |
|---|---|---|---|---|---|
| P1 | H | `L116`, `L123`, `L130`, `L463`–`L464` | «ملاءمة 94%», «ثقة التوقع 88%», «ملاءمة متوقعة: ٩٤٪ · ثقة: ٨٨٪» | `BP §7.2` (no «سيعجبك بنسبة 91%» before calibration), `§4.4` ("ثقة لفظية"; no merged percentage), `§9.3` (four verbal bands), `§2.4 #6`; SPECIFICATION §2 row 6; [PRIVACY.md](PRIVACY.md) §12; [API.md](API.md) `personalFit … never shown as a %` | confidence = one of the four `§9.3` bands as copy; Personal Fit = verbal level, ordinal position in its track, or unlabelled bar — ADR-33 |
| P2 | H | `L433`–`L437`, `L470`–`L493` | post-watch question «كيف كان الفيلم مقارنةً بما توقعتَه؟» with «كما توقعت أو أفضل» / «أقل مما توقعت»; copy says it "يخفّض الثقة في توصيات مشابهة" | `BP §2.4 #2` (the triad is the only explicit preference question), `§4.5` ("لا نطلب نجومًا بعد المشاهدة… ثلاثية جديدة"), ADR-4 (revisit: never) | remove the question; the surface records the watch (`watch-events`) and outcomes (`outcomes`) only; the title re-enters a later triad. «لم أكمل المشاهدة» is a watch *fact*, acceptable only if [API.md](API.md) types it on `watch-events`; it must never feed the model as preference. The mockup's own note at `L497`–`L501` states the rule its buttons break |
| P3 | H | `L193` | instruction «رتّب الأفلام من الأكثر إلى الأقل تأثيرًا فيك» | `BP §2.4 #4`, `§4.3`; fixed copy in `apps/frontend/app/lib/copy.ts`: «رتّب هذه الأفلام حسب إعجابك الشخصي، من الأكثر إلى الأقل.» | use `TRIAD_INSTRUCTION` verbatim; "تأثير" (impact) is not "إعجاب" (liking) |
| P4 | H | `L212`–`L216`, `L231`–`L240` | HTML5 `draggable` only; one «استبدل» button | SPECIFICATION §5.2: drag *or* sequential tap **plus** ↑/↓ buttons, RTL-safe; two neutral controls «لم أشاهده» / «لا أتذكره» each logging its reason (ADR-17) | pointer-event reorder (e.g. `dnd-kit`) + arrow buttons; two replace buttons calling `POST …/replace` with `reason` |
| P5 | H | `L395`–`L402`, `L411` | IMDb and Rotten Tomatoes badges; «جودة نقدية 8.5» repeats the IMDb number in the same card | [DATA_LICENSING.md](DATA_LICENSING.md) §2: IMDb free data "never in a served component"; RT has no licence at all; `BP §6` "لا درجة عالمية مصطنعة" | Public Quality only from a source with a `source_records` row, with attribution; one cell, not two |
| P6 | M | `L115` | reason «…والتحولات المفاجئة مع وتيرة متصاعدة» for Parasite | `BP §9.4` no spoilers, abstract descriptions | reason from driving features only, no plot hints |
| P7 | M | `L378`–`L422` | card has no actions | SPECIFICATION §5.3: add to watchlist, «غير ملائم» (outcome only), where to watch | add the three actions; «غير ملائم» posts `outcomes` |
| P8 | M | `L516`–`L521` | tab «مشاهداتي» opens the post-watch prompt; no library | `BP §5.3` المكتبة: watched, personal ranking, diary, watchlist, search | the fourth tab is the library; post-watch is a moment inside it |
| P9 | M | whole file | no onboarding, no discover/search/mark-watched (needed to unlock triads), no profile/privacy, no "still learning" empty state | SPECIFICATION §5.1, §5.6; API returns 409 until a snapshot exists | out of the mockup's scope, but the missing screens gate the ones shown |
| P10 | L | `L199`–`L200` vs `L116` | «٦٠٪» (Arabic-Indic) and «94%» (Latin) in one app | SPECIFICATION §5.1 step 2 (locale) | one numeral system per locale, from the i18n layer |

### 4.2 Engineering and accessibility

| # | Sev | Mockup | Finding | Fix |
|---|---|---|---|---|
| E1 | H | `L212`–`L216` | HTML5 drag-and-drop does not fire on touch (verified: order unchanged, renderer hung); this is the product's only core interaction | pointer/touch reorder library + keyboard/arrow alternative (P4) |
| E2 | H | `L7`–`L10` | Tailwind Play CDN, React development builds, Babel in the browser | acceptable for a throwaway mockup; nothing is portable to Next 16 / Tailwind 4 — rebuild, do not port |
| E3 | M | `L114`, `L453` | broken poster URL renders alt text over the card; no fallback | text card when no licensed poster (DATA_LICENSING §4 step 5) and an `onError` fallback |
| E4 | M | `L236` (9 px), `L417` (8.5 px), `L334`/`L463` (10 px) | labels below readable minimums; «استبدل» tap target ≈ 36 px | ≥ 12 px labels, ≥ 44 px targets |
| E5 | M | `L334`, `L342` | `uppercase tracking-widest` on Arabic text (no effect; Latin-template leftover); `text-slate-300` label barely visible | remove; use a readable secondary colour |
| E6 | M | `L434`–`L436` | emoji as icons (render differently per OS) | SVG icon set |
| E7 | M | whole file | no dark mode; no loading, empty or error states; all state local | design system with both schemes; skeleton, empty, error, 409 "still learning" states |
| E8 | L | `L343` | film strip forces `dir="ltr"` inside an RTL page | keep RTL scroll, or document the exception |
| E9 | L | `L325`, `L344` | `key={i}` on lists | stable ids |

---

## 5. Clarifications recorded from the review discussion

### 5.1 Does the `BP §7.2` percentage rule apply only to the triad screen?

**Question** (product owner): the sentence «لا يمنح الترتيب النسبي وحده أصلًا مطلقًا… ولا نعرض «سيعجبك بنسبة 91%» حتى تتم معايرة الرقم» — is it specific to the taste-ranking (triad) screen?

**Answer**: no, for three independent reasons.

1. `§7.2` is in chapter 7 (the model), not in chapters 4–5 (screens). The sentence follows the Plackett–Luce equation and constrains what the ranking's *output* may claim: relative probabilities and confidence bands, never an absolute "you will like this X%".
2. The triad screen displays no prediction at all (SPECIFICATION §5.2: poster, title, year, no scores). «سيعجبك بنسبة 91%» can only appear where predictions are shown: recommendation cards, the taste profile, the work page, library ranking, share cards.
3. `§4.4` — the recommendation section itself — repeats the rule: what the user sees on the safe track is "سبب قوي، ثقة لفظية، وتوفر", and "لا ندمجها في نسبة واحدة توحي بدقة غير موجودة". So «ثقة التوقع 88%» violates the recommendation section even without `§7.2`.

**Where the objection is partly right**: the blueprint does not prescribe the display *format* of Personal Fit. A number is not forbidden as such; a number that reads as a probability of liking is. «ملاءمة 94%» reads exactly as «سيعجبك بنسبة 94%». The accepted forms and the scope are now fixed in **ADR-33** and SPECIFICATION §5.3.

| Mockup cell | Rule | Verdict |
|---|---|---|
| «ثقة التوقع 88%» | `§4.4` verbal confidence; `§9.3` four bands | clear violation |
| «ملاءمة 94%» | `§7.2` no «سيعجبك بنسبة» | violation by reading; fixed by a relative form |
| «جودة نقدية 8.5», «التوفر Netflix» | `§4.4` separate values | correct in form; the problem is licensing (P5) |

### 5.2 The post-watch expectation question

Agreed by the product owner as forbidden. Rationale recorded: «أقل مما توقعت» is a two-point liking scale without stars; it reintroduces scale ambiguity (a film "below expectation" may still be the user's favourite of the year), mixes expectation, tonight's mood and liking, and would be a second signal type competing with the triad for the profile. The loop closes as `§4.5` says: the watched title goes into a later triad against two other watched titles, and *that* ranking is "مقارنة التوقع بالترتيب الحقيقي" on the one shared scale. Recorded as a consequence under ADR-4 and in SPECIFICATION §5.4.

---

## 6. Keep / drop / rebuild

**Keep (as intent)**: three-track structure; four-value row with separate cells; poster card with gradient and reason; radar + tiered tags; verbal confidence badge; Arabic-first RTL; bottom navigation.

**Drop**: every percentage (P1); the post-watch question (P2); IMDb/RT badges (P5); the single replace button (P4); emoji icons (E6); the light slate SaaS palette as the base scheme (E7) — the poster cards, the best part of the mockup, are already dark.

**Rebuild in `apps/frontend`** (first screen to review): the triad screen — fixed instruction copy, touch-first reorder with ↑/↓ buttons, two neutral replace controls, licensed poster or text card, no scores. Then recommendations under ADR-33 formats and §5.3 actions.

---

## 7. Limits of this review

- The mockup is not in the repository; line numbers refer to the file as reviewed on 2026-09-03.
- Placeholder Unsplash images, static data, no API; no Lighthouse or field metrics were run — the performance findings are about the stack, not measured load.
- No English locale and no dark scheme exist in the mockup, so neither was tested.
- Visual taste judgements (palette, density) are the reviewer's; the blueprint conformance findings are not.

---

**Changelog**
- 1.0 (2026-09-03): first review; produced ADR-33, an ADR-4 consequence and SPECIFICATION §5.2–§5.4 updates.
