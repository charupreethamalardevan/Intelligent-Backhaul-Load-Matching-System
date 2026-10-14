# IBLMS ML Module 2 -- Profitability Prediction Training Report (v1)

**IMPORTANT CAVEAT:** this model is trained and evaluated entirely on
SYNTHETIC data (see generate_profitability_dataset.py), not real completed-
trip financial outcomes -- IBLMS has no real trip P&L history yet. The
numbers below describe how well the model learned the synthetic label
-generating process, not how well it will predict real-world profit. This
report exists so that claim is never overstated (Development Rule 8).

## What this model predicts, and why it's not a copy of the existing estimate

`backend/services/profitability.js` already computes an estimated profit
margin from a fixed formula (flat ₹/km fuel+toll+other rates). This model
predicts `realized_margin_pct` -- a SYNTHETIC proxy for what a trip's margin
actually works out to once four cost/revenue effects the existing formula
has no way to see are factored in: cargo-specific handling/loading overhead,
dock/pickup waiting-time labour cost, fuel-price and congestion variance
around the fixed rates, and price-realization variance on the quoted price.
Those four effects are generated with real randomness in the dataset and are
**not** given to the model as input features -- see generate_profitability_
dataset.py's module docstring. That is what keeps this a genuine prediction
task with an honest ceiling, not a disguised copy-out.

Unlike ML Module 1 (which excludes its own rule-based aggregate score as a
feature, to force independent learning), this model DOES include the
existing rule-based estimate (`rule_margin_pct` and its cost breakdown) as
input features -- deliberately, because the task here is to learn the
*correction* on top of an estimate that's already a reasonable starting
point, not to re-derive it from zero. See train_profitability_model.py's
module docstring for the full reasoning.

### Model selection (3-fold CV on a 18000-row training subsample, scored by MAE)
- gradient_boosting: CV MAE 2.895 pts
- hist_gradient_boosting: CV MAE 2.807 pts <- selected
- random_forest: CV MAE 3.614 pts

## Dataset
- 90000 synthetic vehicle-trip-load pairs (90,000 generated, 72000 train / 18000 test, 80/20 split).
- Both `rule_margin_pct` and `realized_margin_pct` are clamped to [-100, 80] for realism (an unclamped ratio blows up when a tiny synthetic price is paired with a large reposition distance). 32.1% of rows hit the +80 ceiling and 9.2% hit the -100 floor on the rule estimate alone -- a real limitation of how the synthetic prices were sampled (uniformly, not from a realistic market-clearing distribution), stated here rather than hidden.

## Final model (v1)
- Winning family: **hist_gradient_boosting**.
- Features: the same 7 raw/engineered trip-economics numbers (distances,
  detour, utilization, slack/lead hours, price per tonne-km), the existing
  rule-based cost/margin breakdown, and categorical vehicle/cargo type,
  pickup month, and weekend flag. The four hidden real-world cost/revenue
  effects described above were deliberately excluded as features.

## Test-set metrics (on held-out synthetic data)
- MAE: 2.732 percentage points
- RMSE: 4.979 percentage points
- R-squared: 0.9929

## Context for those numbers -- the comparison that actually matters
- A "predict the training-set average margin for everything" baseline gets
  46.84 pts MAE on this same test set.
- **Just trusting the existing rule-based estimate itself as the profit
  forecast** (i.e. not training anything at all) gets 3.103
  pts MAE on the same test set. The trained model's MAE (2.732 pts)
  should be read against THIS number, not the dummy baseline above -- it is
  the honest answer to "does training a model on top of the existing
  estimate actually help."
- There is a real, intentional ceiling on how low this MAE can go: the label
  includes four injected real-world effects (see above) that are not given
  to the model as inputs, standing in for genuine unpredictability. Driving
  the error much lower would require either leaking one of those hidden
  effects into the feature set (which would be copying the answer, not
  learning) or reducing their injected randomness (which would make the
  synthetic task artificially easy). This report reflects the honest result
  of a real, bounded hyperparameter search instead, consistent with how ML
  Module 1 was evaluated (Addendum 33/34).

## How this is served
The same Flask microservice (app.py) that serves ML Module 1 also loads this
file and profitability_feature_schema.json, computes the same features from
raw vehicle/trip/load JSON, and returns a predicted margin % and predicted
profit (₹). The Node backend calls it as an optional, best-effort signal
alongside -- never instead of -- the existing explainable rule-based
estimate in backend/services/profitability.js, which is completely
unmodified.
