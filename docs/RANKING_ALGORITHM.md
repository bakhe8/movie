# Plackett-Luce Ranking Model - Implementation Guide

A detailed technical reference for implementing the Plackett-Luce model for learning user preferences from triadic rankings.

> See [movie_taste_platform_blueprint_ar.md](movie_taste_platform_blueprint_ar.md) §7 for the authoritative utility model — the population prior term $b(m)$ from blueprint §7.1 is carried through the formula and the implementation below — and §16 for the full evaluation/calibration requirements (this doc's "pairwise accuracy" is one of several required metrics, not the only one — calibration (Brier/ECE) and per-language/country slices are release gates too).

---

## Quick Reference

**What**: Statistical model for learning preference weights from complete rankings

**Input**: User ranks 3 films A > B > C (complete order)

**Output**: Weight vector $w_u$ that predicts user's preference for any film

**Training**: Maximum Likelihood Estimation (MLE) via BFGS

**Evaluation**: Pairwise comparison accuracy (hold-out test set)

---

## Mathematical Foundation

### Problem Setup

Given:
- User $u$ ranks films completely: $\sigma = (i_1, i_2, ..., i_n)$ where $i_1$ preferred over $i_2$ over $i_n$
- Film $i$ has fingerprint $x_i \in \mathbb{R}^d$ (d=30-50 dimensions)

Predict:
- User's preference weight vector $w_u \in \mathbb{R}^d$

### Utility Function (Linear Model)

Preference score for film $i$:

$$U_{u,i} = b(i) + w_u^T x_i + \delta_{u,i}$$

Where:
- $b(i)$ = weak, heavily-shrunk population prior (helps cold start; must never be shown to the user as personal fit — blueprint §7.1)
- $w_u$ = learned weights (same across all films)
- $x_i$ = film fingerprint (fixed)
- $\delta_{u,i}$ = per-film bias (optional, set to 0 for simplicity initially; strongly shrunk once used, so one outlier film doesn't get generalized into $w_u$ — blueprint §7.4)

$b(i)$ can be set to 0 in the very first implementation pass (equivalent to omitting it), but the term should exist in the code from the start so cold-start smoothing has somewhere principled to live, rather than being bolted on ad hoc later.

**Interpretation**:
- Higher $U_{u,i}$ = user prefers film more
- $w_u^T x_i$ = "how much user likes fingerprint dimensions"

### Plackett-Luce Model (Probability)

**Core Assumption**: Given utilities, probability of observing ranking follows Plackett-Luce distribution:

$$P(\sigma | U) = \prod_{k=1}^{n} \frac{\exp(U_{\sigma(k)})}{\sum_{j=k}^{n} \exp(U_{\sigma(j)})}$$

**For Triads** ($n=3$, ranking $A > B > C$):

$$P(A > B > C) = \frac{\exp(U_A)}{\exp(U_A) + \exp(U_B) + \exp(U_C)} \cdot \frac{\exp(U_B)}{\exp(U_B) + \exp(U_C)} \cdot \frac{\exp(U_C)}{\exp(U_C)}$$

The last term simplifies to 1, so:

$$P(A > B > C) = \frac{\exp(U_A)}{S_{ABC}} \cdot \frac{\exp(U_B)}{S_{BC}}$$

Where:
- $S_{ABC} = \exp(U_A) + \exp(U_B) + \exp(U_C)$
- $S_{BC} = \exp(U_B) + \exp(U_C)$

**Log-Likelihood**:

$$\ell(w | A > B > C) = U_A - \log(S_{ABC}) + U_B - \log(S_{BC})$$

### Optimization: Maximum Likelihood Estimation

**Objective**: Maximize log-likelihood over all observed rankings

$$\hat{w}_u = \arg\max_w \sum_{t=1}^{T} \ell(w | \sigma_t)$$

Where:
- $T$ = number of triads
- $\sigma_t$ = $t$-th observed ranking

**Equivalent** (minimization): 

$$\text{Loss}(w) = -\sum_{t=1}^{T} \ell(w | \sigma_t) + \lambda ||w||^2_2$$

The regularization term $\lambda ||w||^2_2$ prevents overfitting (L2 penalty on weights).

### Gradient-Based Optimization

**Gradient** w.r.t. $w$ (for one ranking $A > B > C$):

$$\frac{\partial \ell}{\partial w} = (x_A - \mathbb{E}[x | S_{ABC}]) + (x_B - \mathbb{E}[x | S_{BC}])$$

Where $\mathbb{E}[x | S]$ is expectation over remaining items weighted by softmax.

**Concretely**:

$$\frac{\partial \ell}{\partial w} = x_A - \frac{\exp(U_A) x_A + \exp(U_B) x_B + \exp(U_C) x_C}{S_{ABC}} + x_B - \frac{\exp(U_B) x_B + \exp(U_C) x_C}{S_{BC}}$$

**Solver**: Use BFGS (Quasi-Newton method) from scipy.optimize.minimize()

---

## Implementation Details

### Algorithm: BFGS-Based Fitting

```python
from scipy.optimize import minimize
import numpy as np

class PlackettLuceRanker:
    def fit(self, triads, fingerprints, population_priors=None, regularization=0.01):
        """
        triads: List[Tuple[ids, ranking]]
            - ids: [id_A, id_B, id_C]
            - ranking: [0, 1, 2]  (A is 1st, B is 2nd, C is 3rd)
        fingerprints: Dict[id -> np.array of shape (d,)]
        population_priors: Dict[id -> float], the heavily-shrunk b(i) term
            from blueprint §7.1. Optional — defaults to 0 for every film,
            which is an acceptable first-pass value per the note above —
            but the parameter stays part of the signature so cold-start
            smoothing has somewhere principled to live instead of being
            bolted on later.
        """
        
        self.fingerprint_dim = fingerprints[triads[0][0][0]].shape[0]
        self.regularization = regularization
        self.population_priors = population_priors or {}
        
        # Initialize weights randomly
        w0 = np.random.randn(self.fingerprint_dim) * 0.01
        
        # Define negative log-likelihood
        def objective(w):
            nll = 0.0
            for ids, ranking in triads:
                # Get fingerprints and population priors b(i)
                x = np.array([fingerprints[ids[i]] for i in range(3)])
                b = np.array([self.population_priors.get(ids[i], 0.0) for i in range(3)])
                
                # Compute utilities: U = b(i) + w^T x  (delta_{u,i} omitted here; see §7.4)
                U = b + x @ w  # Shape (3,)
                
                # Compute log-likelihood for this triad
                # ranking[0] = index of 1st place
                # ranking[1] = index of 2nd place
                # ranking[2] = index of 3rd place
                
                idx_1st = ranking[0]
                idx_2nd = ranking[1]
                idx_3rd = ranking[2]
                
                # First position: choose idx_1st over all 3
                log_prob_1 = U[idx_1st] - logsumexp(U)
                
                # Second position: choose idx_2nd over remaining 2
                U_remaining = U[[idx_2nd, idx_3rd]]
                log_prob_2 = U[idx_2nd] - logsumexp(U_remaining)
                
                # Third position: log(1) = 0
                
                log_prob_triad = log_prob_1 + log_prob_2
                nll -= log_prob_triad
            
            # Add L2 regularization (on w only; b(i) is shrunk separately upstream)
            nll += regularization * np.sum(w ** 2)
            return nll
        
        # Optimize
        result = minimize(
            objective,
            w0,
            method='BFGS',
            options={'gtol': 1e-4, 'maxiter': 1000}
        )
        
        self.weights = result.x
        return self
    
    def predict_score(self, fingerprint, population_prior=0.0):
        """Compute utility score for a film: b(i) + w^T x (delta_{u,i} omitted; see §7.4)."""
        return float(population_prior + fingerprint @ self.weights)
    
    def predict_ranking(self, ids, fingerprints):
        """Rank films by predicted preference."""
        scores = [
            self.predict_score(fingerprints[id], self.population_priors.get(id, 0.0))
            for id in ids
        ]
        return np.argsort(scores)[::-1]  # Descending order
```

### Numerical Stability: Log-Sum-Exp Trick

The softmax computation can have numerical overflow/underflow:

$$\text{softmax}(u) = \frac{\exp(u_i)}{\sum_j \exp(u_j)}$$

**Solution: Log-sum-exp trick**

$$\log \text{softmax}(u_i) = u_i - \text{logsumexp}(u)$$

Where:

$$\text{logsumexp}(u) = \max(u) + \log\left(\sum_j \exp(u_j - \max(u))\right)$$

**Python**:
```python
from scipy.special import logsumexp

# Safe computation
log_prob = u[i] - logsumexp(u)  # Won't overflow/underflow
```

---

## Practical Considerations

### Hyperparameters

| Parameter | Default | Range | Effect |
|-----------|---------|-------|--------|
| `regularization` | 0.01 | 0.001-0.1 | Stronger regularization = simpler model, less overfitting |
| `max_iter` | 1000 | 100-10000 | More iterations = more accurate convergence |
| `gtol` | 1e-4 | 1e-5 to 1e-3 | Gradient tolerance; smaller = more precise |

**Tuning**:
- Start with defaults
- If overfitting (perfect training accuracy but poor test): increase regularization
- If underfitting (low training accuracy): decrease regularization
- If not converging: increase max_iter

### Data Requirements

**Illustrative triad count for a stable $w_u$**: 15-20, as a starting rule of thumb — not a fixed product promise. Per blueprint §16.5/§17, the actual thresholds for each gate are set experimentally, not fixed in this document.

**Rationale** (rough degrees-of-freedom heuristic for $w_u$ alone, not for the blueprint's early-value gate below):
- 3 triads = 9 pairwise constraints
- ~30 degrees of freedom (weight dimensions)
- Rule of thumb: 2-3 observations per degree of freedom
- 15 triads = 45 pairwise constraints = ~50 to 150 degrees of freedom coverage

This is about when $w_u$ (personal weights) stops being noisy — it is not the same question as the blueprint's Gate 2 ("does the user see a useful result after 3-5 triads?", blueprint §§0/3.3). Those first 3-5 triads are expected to produce directionally usable initial recommendations because the population prior $b(i)$ and content-fingerprint similarity already carry signal before $w_u$ has converged — the model is not "random" in that window. A rough, non-promised growth curve, to be validated experimentally per blueprint §16.5 rather than treated as settled:
```
After 3-5 triads: Early value — initial profile, library ranking, first recommendations (blueprint Gate 2)
After 10 triads:  w_u starts to stabilize
After 15-20 triads: w_u reasonably stable
After 30+ triads: Personalization strong, rare films handled
```

### Handling "Haven't Watched" Films

**Problem**: User can't rank film they haven't seen

**Solution**: Allow replacement before ranking

```python
# Example: User hasn't seen Film A, wants to replace with Film D
triad_original = ["A", "B", "C"]
replacement = {"A": "D"}  # A → D

triad_effective = ["D", "B", "C"]
ranking = [0, 1, 2]  # D > B > C

# Store both:
triads.append({
    "original_ids": ["A", "B", "C"],
    "effective_ids": ["D", "B", "C"],
    "ranking": [0, 1, 2],
    "replacements": {"A": "D"}
})
```

**Don't**: Treat "haven't watched" as a preference signal (it's not)

---

## Evaluation Metrics

### Primary: Pairwise Comparison Accuracy

**Definition**: Fraction of pairwise comparisons predicted correctly

**Example**:
```
User ranked: A > B > C

Pairwise comparisons:
1. A vs B: Model predicts score_A > score_B → ✓ Correct
2. A vs C: Model predicts score_A > score_C → ✓ Correct  
3. B vs C: Model predicts score_B < score_C → ✗ Wrong

Accuracy for this triad: 2/3 ≈ 67%
```

**Calculation across all triads**:
```python
def pairwise_accuracy(triads, fingerprints, ranker):
    correct = 0
    total = 0
    
    for ids, ranking in triads:
        # Extract pairs
        for i in range(3):
            for j in range(i+1, 3):
                idx_i, idx_j = ranking[i], ranking[j]
                id_i, id_j = ids[idx_i], ids[idx_j]
                
                score_i = ranker.predict_score(fingerprints[id_i])
                score_j = ranker.predict_score(fingerprints[id_j])
                
                if score_i > score_j:
                    correct += 1
                total += 1
    
    return correct / total
```

### Secondary: Ranking Correlation (Spearman's Rho)

For hold-out test set, compute correlation between true ranking and predicted ranking:

```python
from scipy.stats import spearmanr

def ranking_correlation(true_ranking, predicted_scores):
    """
    true_ranking: [0, 1, 2] (A is 1st, B is 2nd, C is 3rd)
    predicted_scores: [score_A, score_B, score_C]
    """
    predicted_ranking = np.argsort(predicted_scores)[::-1]
    rho, pvalue = spearmanr(true_ranking, predicted_ranking)
    return rho
```

### Baseline Comparisons

Always compare against:

1. **Random Guessing**: 50% pairwise accuracy (baseline floor)

2. **Global Popularity**: Sort by IMDb rating
   ```python
   baseline_scores = [imdb_rating[id] for id in ids]
   ```

3. **Genre Similarity**: All films within same genre score high
   ```python
   baseline_scores = [1 if genre == user_pref_genre else 0 for id in ids]
   ```

4. **Embedding Cosine Similarity**: Use OpenAI embeddings
   ```python
   baseline_scores = [cosine_similarity(user_embedding, film_embedding) for id in ids]
   ```

5. **Simple Content Model**: Average fingerprint dimensions the user ranked high
   ```python
   watched_fingerprints = [fingerprints[id] for id in user_watched]
   avg_fingerprint = np.mean(watched_fingerprints, axis=0)
   baseline_scores = [fingerprints[id] @ avg_fingerprint for id in ids]
   ```

**Success Criterion**: Model beats all baselines by a statistically significant margin on held-out triads, with the margin size and required confidence set experimentally before each gate (blueprint §16.5, §17) rather than fixed here as "5+ points" — treat that number as an illustrative starting point, not the actual bar

---

## Training Workflow

### Step 1: Collect Triads (User-Facing)

```
User rates 20 triads over time
Each triad: A > B > C
Store events in database
```

### Step 2: Batch Training (Backend, Async)

```python
# Trigger every N triads or daily
def train_user_model(user_id, min_triads=10):
    triads = database.query_user_triads(user_id)
    if len(triads) < min_triads:
        return None  # Too few data points
    
    # Split: 80% train, 20% test
    train_triads = triads[:int(0.8 * len(triads))]
    test_triads = triads[int(0.8 * len(triads)):]
    
    # Train
    ranker = PlackettLuceRanker(fingerprint_dim=50)
    ranker.fit(train_triads, fingerprints, regularization=0.01)
    
    # Evaluate
    train_acc = pairwise_accuracy(train_triads, fingerprints, ranker)
    test_acc = pairwise_accuracy(test_triads, fingerprints, ranker)
    
    # Check for overfitting
    if train_acc - test_acc > 0.1:  # 10% gap
        # Increase regularization and retry
        pass
    
    # Store weights
    database.store_model_snapshot(user_id, ranker.weights, test_acc)
    
    # Cache in Redis
    redis.set(f"user_model:{user_id}", json.dumps(ranker.weights))
    
    return test_acc
```

### Step 3: Serving (Real-Time Inference)

```python
# Fast lookup
def recommend_films(user_id, num_recommendations=10):
    # Load weights from cache
    weights = redis.get(f"user_model:{user_id}")
    if not weights:
        # Fallback: use database
        weights = database.query_latest_weights(user_id)
    
    # Score all unwatched films: U = b(i) + w^T x (blueprint §7.1)
    scores = {}
    for film_id in unwatched_films:
        fingerprint = get_fingerprint(film_id)
        prior = get_population_prior(film_id)  # heavily-shrunk b(i); 0.0 if unset
        score = prior + fingerprint @ weights
        scores[film_id] = score
    
    # Top 10
    top_films = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:10]
    return top_films
```

### Step 4: Monitoring

```python
# Track model quality over time
def monitor_model_quality(user_id):
    snapshots = database.query_model_snapshots(user_id)
    
    # Plot accuracy vs triads
    triads = [s.training_triad_count for s in snapshots]
    accuracies = [s.pairwise_accuracy for s in snapshots]
    
    plt.plot(triads, accuracies)
    plt.xlabel("Number of Triads")
    plt.ylabel("Pairwise Accuracy")
    plt.show()
    
    # Alert if accuracy decreases (model drift)
    if accuracies[-1] < accuracies[-2] - 0.05:
        alert(f"Model accuracy dropped for user {user_id}")
```

---

## Common Pitfalls & Solutions

| Problem | Symptom | Solution |
|---------|---------|----------|
| **Overfitting** | 90% train acc, 50% test acc | Increase regularization |
| **Underfitting** | 60% train acc, 55% test acc | Decrease regularization, add more data |
| **No convergence** | Loss doesn't decrease | Increase max_iter, reduce learning rate |
| **Numerical instability** | NaN in weights | Use logsumexp, normalize fingerprints |
| **Slow training** | Training takes > 10s | Vectorize computation, use GPU |
| **Cold start** | New user has 0 triads | Start with generic model, adapt quickly |

---

## Performance Optimization

### Vectorization (NumPy)

```python
# ❌ SLOW: Loop over triads
for ids, ranking in triads:
    x = np.array([fingerprints[ids[i]] for i in range(3)])
    U = x @ w
    # ... compute loss

# ✅ FAST: Batch computation
X = np.array([[fingerprints[ids[i]] for i in range(3)] for ids, _ in triads])
U = X @ w  # Shape: (num_triads, 3)
# ... compute loss for all triads at once
```

### GPU Acceleration (Optional)

```python
# Use JAX for automatic differentiation + GPU
import jax
import jax.numpy as jnp

@jax.jit  # Compile to GPU
def negative_log_likelihood(w):
    U = X @ w
    # ... compute NLL
    return nll
```

### Lazy Loading (Large Catalogs)

```python
# Don't load all fingerprints at start
class LazyFingerprints:
    def __init__(self, db):
        self.db = db
        self.cache = {}
    
    def __getitem__(self, film_id):
        if film_id not in self.cache:
            self.cache[film_id] = self.db.query_fingerprint(film_id)
        return self.cache[film_id]
```

---

## Testing

### Unit Tests

```python
def test_plackett_luce_on_synthetic_data():
    # Create synthetic data with known weights
    true_weights = np.array([1.0, -0.5, 0.8])
    
    # Generate synthetic triads
    triads = generate_synthetic_rankings(true_weights, num_triads=50)
    
    # Train model
    ranker = PlackettLuceRanker(fingerprint_dim=3)
    ranker.fit(triads, fingerprints, regularization=0.01)
    
    # Weights should be close to true_weights
    np.testing.assert_array_almost_equal(
        ranker.weights, true_weights, decimal=1
    )

def test_ranking_order():
    # If A > B in training, model should score A > B
    triads = [
        (["A", "B", "C"], [0, 1, 2])  # A > B > C
    ] * 10
    
    ranker.fit(triads, fingerprints)
    score_A = ranker.predict_score(fingerprints["A"])
    score_B = ranker.predict_score(fingerprints["B"])
    
    assert score_A > score_B
```

### Integration Tests

```python
def test_end_to_end_ranking_and_recommendation():
    # 1. User creates profile
    user = create_user("test@example.com")
    
    # 2. User ranks 10 triads
    for i in range(10):
        triad = get_next_triad(user.id)
        ranking = user_rank_triad(user.id, triad.id, [0, 1, 2])
        assert ranking.status == "completed"
    
    # 3. System trains model
    model = train_user_model(user.id)
    assert model.accuracy > 0.55  # Better than random
    
    # 4. Recommendations generated
    recommendations = get_recommendations(user.id)
    assert len(recommendations) >= 5
    assert recommendations[0].score >= recommendations[-1].score
```

---

## References

- **Luce's Choice Axiom**: https://en.wikipedia.org/wiki/Luce%27s_choice_axiom
- **Plackett-Luce Model**: Plackett (1975), "The analysis of permutations"
- **MLE Optimization**: Boyd & Vandenberghe (2004), "Convex Optimization"
- **SciPy BFGS**: https://docs.scipy.org/doc/scipy/reference/optimize.html

---

**Last Updated**: 2025-01-02  
**Status**: Ready for implementation
