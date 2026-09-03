# Model Service Specification — Ranking, Selection, Confidence, Attribution

**Status**: Derived from blueprint `§7` (utility model, Plackett–Luce, time layers, exceptions, shared latent space, silent vs disclosed use), `§8` (triad selection policy), `§9` (confidence and explanation), `§10.3` (public quality vs personal fit), `§14.1` (candidate generation and reranking), `§16` (evaluation). Decisions: ADR-3, ADR-8, ADR-13, ADR-19–ADR-22, ADR-25, ADR-59, ADR-62, ADR-64, ADR-69, ADR-71, ADR-75.
**Version**: 2.0 — 2026-09-04 (rewrite of the 2025-dated implementation guide; the base Plackett–Luce math is unchanged, everything around it now matches the blueprint; ADR-71 closes `§9.2`'s diversity criterion on all three named axes; ADR-75 wires the third fingerprint block, 28 to 40 dimensions; §8 records the acceptance gate's real implementation and thresholds, `services/workers/src/evaluation.py`).

This is the contract for `services/workers` (the Python model service). What exists today is in §16.

---

## 1. Utility model (`BP §7.1`)

For profile $u$ and title $m$ with published fingerprint $\phi_m$:

$$s(u,m) = b(m) + \theta_u^{\top}\phi_m + p_u^{\top}q_m + \delta_{u,m}$$

| Term | Meaning | Protection against distortion | Phase 0 / Alpha |
|---|---|---|---|
| $b(m)$ | weak population prior (general acceptance / public quality, shrunk) | strong shrinkage; **displayed separately** from Personal Fit | present in code path; value 0 until a licensed Public Quality source exists |
| $\theta_u^{\top}\phi_m$ | interpretable content fit | L2/hierarchical prior; diverse evidence before a tendency is shown | core of the fit |
| $p_u^{\top}q_m$ | collaborative signal from **this product's own** interactions | enters only with enough internal data; no future leakage | not fitted; the externally-seeded shared space (§11) is a different, earlier source |
| $\delta_{u,m}$ | this-profile-this-title exception | very strong shrinkage; never generalized | per-title bias term, shrunk |

The profile starts from a hierarchical population prior and is released from it as evidence accumulates. UI language and location are never shortcuts for taste. Person effects (director, writer, cast) are separate hierarchical, strongly shrunk blocks that only appear after diverse works and contexts (`BP §7.1`, `§10.2`).

## 2. Listwise Plackett–Luce likelihood (`BP §7.2`)

For a triad answered $A \succ B \succ C$ with utilities $s_A, s_B, s_C$:

$$P(A \succ B \succ C) = \frac{e^{s_A}}{e^{s_A}+e^{s_B}+e^{s_C}} \cdot \frac{e^{s_B}}{e^{s_B}+e^{s_C}}$$

Log-likelihood of one event: $\ell = s_A - \operatorname{logsumexp}(s_A,s_B,s_C) + s_B - \operatorname{logsumexp}(s_B,s_C)$.

**Rule**: a triad is one listwise event in storage, splitting and loss. It is never decomposed into three independent full-weight pairwise comparisons — the pairs are correlated and doing so inflates confidence (`BP §7.2`). Pairwise accuracy is a *post-hoc evaluation metric only* (§8).

Relative rankings do not establish an absolute "liked" anchor: a user may rank three films they disliked. The system therefore works in relative probabilities and confidence bands and never shows "91% you will like this" until calibrated against post-watch outcomes (`BP §7.2`).

### 2.1 Per-profile estimation (before the shared space exists)

$$\hat\theta_u = \arg\min_\theta \; -\sum_{t \in \mathcal{T}_u^{train}} \ell_t(\theta) + \lambda\|\theta\|_2^2 + \lambda_\delta \sum_m \delta_{u,m}^2$$

- Solver: BFGS (`scipy.optimize.minimize`) with the log-sum-exp trick; gradient of one event is $(\phi_A - \mathbb{E}_{S_{ABC}}[\phi]) + (\phi_B - \mathbb{E}_{S_{BC}}[\phi])$.
- Initialization: $\theta_0 = 0$ (deterministic; the objective is convex, so nothing is lost, and reproducibility is an Alpha DoD item, `BP §18.1`). Implemented in `ranker.py`; a test asserts two fits on the same events give identical weights.
- $b(m)$ is fixed during the fit (not optimized), supplied by the population layer.
- Hyperparameters ($\lambda$, $\lambda_\delta$, `gtol`, `maxiter`) are part of `model_versions.thresholds` and tuned on held-out NLL, never hard-coded in docs. Implemented 2026-09-04 for $\lambda$ (ADR-69): `train_and_evaluate()` fits every candidate in a small grid (`0.01, 0.03, 0.1, 0.3`) on the same train/held-out split and keeps the one with the lowest held-out NLL, refitting the served weights with that value — below the 5-triad floor it defaults to the grid's smallest entry. Not yet persisted to `model_versions.thresholds`: that table exists (M4) but nothing writes to it yet (a separate, still-open gap this didn't need to close).

### 2.2 Per-profile calibration (once the shared space exists, `BP §7.5`)

$\theta_u = \mu + W z_u$ with $z_u \in \mathbb{R}^k$ ($k \approx 15$–$30$), $W$ and $\mu$ from the shared latent space version the snapshot is calibrated against. Estimate $z_u$ by MAP with prior $z_u \sim \mathcal{N}(0, I)$ over the same listwise likelihood. This is MIRT/CAT-style calibration: the profile is located inside a pre-built map rather than solved from scratch, which is what makes a usable position after few triads plausible — to be **measured**, not assumed (`BP §16.5`).

## 3. Exceptions δ (`BP §7.4`)

- Detected as a large residual — but measured against the **population baseline** from the shared space (or $b(m)$ before it exists), not only against the still-immature $\theta_u$, to break the circularity for new users.
- Optional explicit tag "special personal value" is faster and more accurate; the statistical detector is the fallback.
- The film keeps its rank; only its generalization into $\theta_u$ is reduced. Re-examined if the pattern repeats.

## 4. Time layers (`BP §7.3`)

| Layer | MVP | Later |
|---|---|---|
| Long-term profile | ✅ the only learned layer | very slow decay |
| Recent window | — | time-weighted layer with regularization (`recentWeights` column reserved) |
| Session Fit | — | separate temporary layer; never overwrites the core |
| Real drift | — | declared only after repeated temporal evidence; history kept |

Timestamps (`shownAt`, `answeredAt`) are mandatory on every event now, even though the MVP learns only the long-term layer.

## 5. Unknown features (`BP §11.3`, ADR-19)

Missing feature = unknown. Training excludes triads with incomplete vectors; scoring imputes the candidate-pool mean and applies a fingerprint-quality penalty to the confidence input (one band down, plus a `fingerprintCoverage` field on every item); reasons never cite an unknown feature. Implemented 2026-09-03 in the trainer, the ranker (which refuses undescribed titles) and the scorer; zero-filling is gone. Since 2026-09-04 (ADR-69, ADR-75), the vector is 40 dimensions (13 V1 + 15 V2 + 12 V3 families, `FINGERPRINT_SCHEMA.md` §3.1/§3.3) and "complete" means all 40 known — a title enriched with V1(+V2) only (no `v3` block, true of the original 15 seed titles neither enrichment pass has touched) is a valid scoring candidate (imputed like any missing dimension) but excludes any triad it appears in from training until it gets the missing block(s).

## 6. Training protocol (`BP §16.1`, ADR-22)

Per profile, on trigger (every 3 newly completed triads, on demand, or nightly):

1. Load completed triads ordered by `answeredAt`, excluding `holdout = true` rows (policy-reserved validation triads, `BP §8.3`).
2. Temporal split inside the profile: the most recent $\max(1, \lfloor 0.2\,n \rfloor)$ triads are held out when $n \ge 5$; below that, train on everything and report **no** held-out metrics (band stays `inconclusive`/`initial`).
3. Whole triads stay on one side of the split. Fingerprints and population priors are frozen at the cutoff; nothing from the future enters the features.
4. Fit (§2.1 or §2.2). Evaluate on the held-out slice: NLL, top-1 accuracy, full-order accuracy, pairwise accuracy, Kendall τ.
5. Persist `user_model_snapshots` with weights, bias terms, posterior/uncertainty, `trainingTriadCount`, `heldOutTriadCount`, `heldOutNll`, `heldOutPairwiseAccuracy`, `modelVersion`, `calibratedAgainst`.
6. Then refit on all non-reserved triads for serving (the held-out metrics describe the protocol, the served weights use all data), recording both in the snapshot.

Separate new-user and new-item experiments use frozen features at the cutoff; a whole-series/whole-director hold-out test distinguishes learning from name memorization (`BP §16.1`).

## 7. Metrics (`BP §16.2`)

| Level | Metrics |
|---|---|
| Model | PL NLL, top-1, full-order accuracy, pairwise accuracy, Kendall τ, NDCG/Recall@K |
| Confidence | Brier score, ECE, calibration plots; epistemic uncertainty separated from inconsistency |
| Question efficiency | loss/accuracy improvement per minute; curves after 1, 3, 5, 10, 20 triads |
| System quality | coverage, diversity, novelty, popularity bubble, performance by language and country |
| UX | completion, answer time, replacement rate, verification consistency, dropout, fatigue |
| Product value | acceptance, watch start, completion, later ranking, decision time, D7/D30 |

## 8. Baselines and the acceptance gate (`BP §16.3`, `§16.5`)

Fair baselines: popularity / critic prior (from the Public Quality source — IMDb ratings under their non-commercial terms during the free period, owner decision 2026-09-04, [DATA_LICENSING.md](DATA_LICENSING.md) §3.2); simple genre/content similarity; Bradley–Terry pairwise; collaborative filtering/BPR once internal data exists; random or semi-fixed triads vs adaptive; in the Phase 0 lab: triads vs pairs vs single ratings under equal time.

**Gate for any model version**: it must improve NLL, learning per minute, calibration and post-watch outcomes, without increasing fatigue or degrading language/country coverage, and must beat the best simpler alternative — measured on a cohort with confidence intervals fixed before the test. Raising one accuracy number is not enough.

**Implemented** (`services/workers/src/evaluation.py`, `make evaluate`, ALPHA_PLAN item 6.1): reads whatever `training.FINGERPRINT_DIMENSIONS` currently serves (40 keys since ADR-75), so a fingerprint-block wiring change is picked up automatically with no separate gate update. Baselines: random, popularity (watch count), genre match, and the pre-ADR-69 V1-only Plackett–Luce model as an ablation. Thresholds, fixed before any run (CLI flags, not tuned to the data): **≥ 30** held-out triads and **≥ 3** profiles to have an opinion at all; beats the best baseline by a **≥ 0.03** pairwise-accuracy margin; the model-vs-baseline difference's 95% cluster-bootstrap interval (resampling profiles, since one profile's triads aren't independent) excludes zero; NLL better than both the random baseline and the V1-only ablation; no language slice with at least 20 triads falls more than **0.05** behind the best baseline. All five must pass, and there must be enough held-out data to evaluate them at all — short of that the gate reports "insufficient data" rather than a false pass or fail. The report is JSON `POST /admin/models` accepts as `evalReport`; registering and activating a version on `movie-postgres` after a real pass is the owner's call, not automatic.

## 9. Triad selection policy (`BP §8`)

Goal: the most reliable information per minute without fatigue.

Six triad functions (`BP §8.1`): initial map, controlled comparison (one or two features vary), cross bridge (hidden axis across genres/languages), fine boundary, verification/refutation in an independent context, exploration/exception.

Selection score (`BP §8.2`):

$$\operatorname{Score}(T) = \frac{IG(T)\,P(\text{watched all})\,P(\text{reliable answer})}{E[\text{time}]+\varepsilon} + \lambda_c\,\text{Coverage} + \lambda_b\,\text{Bridge} - \lambda_r\,\text{Repeat} - \lambda_f\,\text{Fatigue}$$

- $IG$ is mutual information under an approximate posterior over $\theta_u$ (or $z_u$), so it separates "we lack evidence" from "the user is inconsistent". With the shared space, $IG$ targets the least-certain factor (Fisher information), `BP §7.5`.
- The policy samples from the top-$K$ candidates rather than always taking the argmax, and logs $\rho = P(\text{policy chose } T)$ as `selectionPropensity` on every triad.
- Safety constraints (`BP §8.3`): no series/director/language repetition that makes inference circular; a small **declared** exploration share; positions randomized and logged; triads with high replacement or poor-memory probability are demoted; session limits and free stop (fatigue is a cost); some triads reserved as `holdout = true` for validation and never trained on.
- Policy versions: `random-v1` (today: uniform draw of 3 from watched-unranked, $\rho = 1/\binom{n}{3}$) → `adaptive-v1` (target). Every triad row records its `policyVersion`.

## 10. Confidence (`BP §9`)

Four things that must not be confused: preference probability, epistemic uncertainty, inconsistency/context, fingerprint confidence (`BP §9.1`).

A tendency ("tends to…") is shown only when all `BP §9.2` criteria hold: stable posterior direction beyond a pre-set threshold, sufficient *effective* evidence (not one series repeated), diversity of directors/languages/genres, successful prediction of later held-out comparisons, and healthy fingerprint quality underneath.

Bands (`BP §9.3`): `initial` (3–5 triads or correlated evidence), `likely` (several pieces of evidence in a narrow context), `strong` (repeated across contexts and predictive), `inconclusive` (conflicting evidence or weak fingerprint). Current code derives the band from `trainingTriadCount` (interim heuristic, ADR-21), demoted one step for incomplete fingerprint coverage (ADR-19), and overridden to `inconclusive` outright when any of three other `§9.2` criteria fails: `heldOutPairwiseAccuracy` at or below chance (0.5) — the domain-standard reading of "successful prediction of held-out comparisons," inverted (ADR-59); `posterior.standardErrors` showing no dimension's weight even one standard error from zero — "stable posterior direction," read as *no* claimed direction is statistically distinguishable from noise under the fit's own Laplace approximation (`training.py`'s `ranker.py` reads this straight off BFGS's inverse Hessian at the regularized optimum: a MAP estimate under the L2 term's implicit Gaussian prior, so the inverse Hessian there is the standard Laplace approximation to the posterior covariance); and fewer than 2 distinct genres/languages/directors across the triads trained on — the "sufficient effective evidence (not one series repeated)" and "diversity of ... directors/languages/genres" criteria read together, checked identically for all three named axes: genre (ADR-62, 2026-09-03), original language (`titles.originalLanguage`, ADR-64, 2026-09-03), and director (`credits`/`people` joined by `role = 'director'`, ADR-71, 2026-09-04, unblocked by gap 6's ingestion pass, ADR-70). All five gated the same way: `NULL`/unknown below the 5-triad floor (ADR-31) falls back to the triad-count heuristic unchanged, never treated as failing. `§9.2`'s diversity criterion is now checked on all three named axes in full. A numeric probability may be shown only after Brier/ECE calibration against confirmed post-watch outcomes.

## 11. Shared latent space (`BP §7.5`)

- One population factor model ($k \approx 15$–$30$) over all profiles' triads and fingerprints, retrained on a schedule (e.g. weekly) as a batch job inside the model service — not a separate service until `BP §12.3` triggers fire.
- Seeding before internal data exists is allowed from data whose terms cover the current stage: while the service earns nothing ([DATA_LICENSING.md](DATA_LICENSING.md) §0, owner decision 2026-09-04) MovieLens/Tag Genome's research terms apply and no GroupLens permission is requested; that permission is an input to the revenue-model study, and ADR-13's default stands anyway — the space starts from Alpha-cohort data, external seeding is optional. `shared_latent_space_versions.seedDataSources[].licenseStatus` may be `non_commercial_only` for activation during the free period and must be `commercial_allowed` once revenue starts.
- Acceptance: the general `BP §16.5` gate applied to this component, at cohort level (`BP §17.3`), against an individual-only baseline.
- Feedback-loop risk: retraining on triads shaped by earlier recommendations requires the same propensity logging and off-policy evaluation as individual evaluation (`BP §21.2`).

## 12. Recommendation scoring, tracks and reranking (`BP §4.4`, `§10.3`, `§14.1`)

Pipeline: content-similarity candidates → collaborative candidates when mature → public quality + exploration → rights and availability filter → personal rerank + diversity + confidence. Candidate generation targets recall/coverage; reranking targets fit/context/diversity. The reason each candidate entered and its display propensity are logged (`recommendations.candidateSource`, `selectionPropensity`).

Internal rerank score (`BP §10.3`, ADR-20):

$$\text{Score} = \lambda_u \cdot \text{PublicQuality} + (1-\lambda_u)\cdot \text{PersonalFit} + \text{ContextFit} + \text{Exploration}$$

with $\lambda_u$ decreasing as reliable evidence about the profile accumulates (ContextFit is 0 in MVP; Exploration is the declared share). This blend decides **which** candidates are shown. It is never displayed: the API returns `personalFit`, `publicQuality`, `watchability` and `confidenceBand` separately (`BP §4.4`), and the displayed reason must name the component that actually dominated (§13).

Tracks (`BP §4.4`): `safe` — highest fit inside the region the model knows (high confidence), strong reason, availability; `discovery` — crosses a genre or language through a *validated* hidden axis; `outside_usual` — higher-risk exploration to prevent the bubble, with the reason and confidence limit stated. Deterministic ordering inside each track; the exploration share is declared and logged. Availability (market, platform, dub/subtitles) is a filter and context, never a taste feature. Commercial commission never moves an item in organic ranking.

## 13. Attribution gate — silent vs disclosed (`BP §7.6`, `§10.3`, `§12.2`)

The shared space and the public prior may be used **computationally from day one** (candidates, triad selection, safety net). What may be **said** to the user is gated:

| Phase | Condition | Allowed "about your taste" language |
|---|---|---|
| 1. Individual-only | from the first triad (includes the `initial` band) | claims traceable to specific triads this user ranked |
| 2. Balance | this user's position is stable (≈10–15 well-chosen triads, not a hard cutoff) | simple cross-genre links, only if repeated in *this user's own* contradictions; no other users cited |
| 3. Enrichment | a population axis is statistically shown to predict *this user's* held-out rankings better than the individual model (protocol of §6) | "similar to a pattern in similar tastes", explicitly labelled as an addition |

Product-level gate: phases 2–3 are disabled for everyone until the shared space passes the cohort gate in `BP §17.3`. In MVP every reason is `evidenceSource: individual`.

Reason wording must also track $\lambda_u$ (`BP §10.3`): when public quality dominates the score, say so and admit the model does not yet know the user; only when Personal Fit dominates *and is validated* say "fits your taste specifically".

```python
def attribute(reason_evidence, user_gate_state, product_gate_open) -> tuple[str, str]:
    if reason_evidence.individually_traceable():
        return reason_evidence.individual_text(), "individual"
    if product_gate_open and user_gate_state.passes_phase3(reason_evidence):
        return reason_evidence.enriched_text(), "population_enriched"
    return reason_evidence.generic_text(), "individual"   # never borrow unearned population language
```

## 14. Explanations (`BP §9.4`, `§15`)

Template explanations from the evidence payload are the default; an LLM may only rephrase them post hoc and never on the ranking path. Rules in [FINGERPRINT_SCHEMA.md §7](FINGERPRINT_SCHEMA.md).

## 15. Service interface (ADR-25)

Target: a FastAPI service in `services/workers` exposing

| Endpoint | Purpose | Called |
|---|---|---|
| `POST /train` `{ profileId }` | run §6, write a snapshot, return metrics | async by the backend after every 3 completed triads or by an admin |
| `POST /triads/select` `{ profileId, poolTitleIds[], recent[], policyVersion }` | run §9, return 3 titles + `selectionPropensity` + reason | synchronously by `POST /api/v1/triads/next` |
| `POST /score` `{ profileId, candidateTitleIds[] }` | §12 scores per candidate + confidence inputs + reason evidence | synchronously by `GET /api/v1/recommendations` |
| `GET /taste-profile/{profileId}` | tendencies, unknowns, exceptions with evidence | by `GET /api/v1/taste-profile` |
| `POST /shared-space/retrain` | §11 batch job | scheduler / admin |

Today the only entry point is the CLI `python -m src.training <profileId>` (or `poetry run python -m src.training <profileId>`) which reads and writes Postgres directly; the backend never invokes Python. A queue is added only when `BP §12.3` triggers fire — not Redis/BullMQ specifically, since neither is a dependency of this codebase (M8).

## 16. Reference implementation notes

Vectorized NLL for $n$ triads with feature matrix $X \in \mathbb{R}^{n\times3\times d}$, priors $B \in \mathbb{R}^{n\times3}$ and rankings $R \in \{0,1,2\}^{n\times3}$:

```python
def nll(theta, X, B, R, lam):
    S = B + X @ theta                                   # (n, 3)
    first = np.take_along_axis(S, R[:, :1], 1)[:, 0]
    second = np.take_along_axis(S, R[:, 1:2], 1)[:, 0]
    rest = np.take_along_axis(S, R[:, 1:], 1)          # (n, 2): 2nd and 3rd
    ll = first - logsumexp(S, axis=1) + second - logsumexp(rest, axis=1)
    return -ll.sum() + lam * theta @ theta
```

Tests every model version must pass: recovers known weights from synthetic listwise data; honours a strong prior with near-zero weights; leaves unknown features out instead of zero-filling; temporal split keeps whole triads; pairwise accuracy is 0 for an inverted model and 1 for a perfect one; `selectionPropensity` sums correctly over the candidate set for the policy.

## 17. Current implementation (2026-09-03)

`services/workers/src/ranker.py` implements the listwise PL fit with deterministic zero initialization, `population_priors` (unused, all zero), a `bias_terms` field that is wired end to end but never populated by `fit()` (always `{}`), BFGS, in-sample `compute_pairwise_accuracy`, and `compute_nll`; it refuses undescribed titles instead of zero-filling. `training.py` is the CLI trainer: all completed triads whose three titles have complete fingerprints, ordered by `createdAt` as a stand-in for `answeredAt` (ADR-31), with the most recent `floor(0.2n)` held out for evaluation when `n ≥ 5` per §6 above; the served weights are still refit on all of it. 36 unit tests pass. No selection policy beyond `random-v1` (in the NestJS backend), no confidence criteria, no shared space, no attribution gate, no FastAPI service. Details: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## References

- Plackett (1975), *The analysis of permutations*; Luce's choice axiom.
- Active ranking with pairwise comparisons; PAC battling bandits in the Plackett–Luce model (`BP App. D` [م9], [م10]).
- Multidimensional IRT / computerized adaptive testing (background for §2.2).
- Blueprint sections cited inline are the authority for every rule here.
