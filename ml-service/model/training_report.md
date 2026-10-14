# IBLMS ML Module 1 -- Training Report (v2)

**IMPORTANT CAVEAT:** this model is trained and evaluated entirely on
SYNTHETIC data (see generate_dataset.py), not real historical booking
outcomes -- IBLMS has no real accept/reject history to learn from yet. The
numbers below describe how well the model learned the synthetic label
-generating process, not how well it will predict real-world outcomes. This
report exists so that claim is never overstated (Development Rule 8).

## What changed from v1

v1 was a single, hand-picked GradientBoostingClassifier configuration. v2
instead runs a cross-validated hyperparameter search across three model
families and picks the best by CV ROC-AUC, then calibrates the winner's
probabilities. The feature set is unchanged -- no feature derived from
generate_dataset.py's hidden label formula was added, since that would be
leaking the answer rather than genuinely improving the model.

### Model selection (4-fold CV on the training split, ROC-AUC)
- gradient_boosting: CV ROC-AUC 0.7636 <- selected
- hist_gradient_boosting: CV ROC-AUC 0.7601
- random_forest: CV ROC-AUC 0.7599

### Calibration's own effect (isolated from the hyperparameter search)
- Before calibration: ROC-AUC 0.7691, Brier score 0.1803
- After calibration: ROC-AUC 0.7691, Brier score 0.1803
(Calibration mainly targets Brier score -- how trustworthy the probability
numbers themselves are -- not the ranking quality ROC-AUC measures, so a
small or even slightly negative AUC change here is expected; the Brier
improvement is the one that matters.)

## Dataset
- 90000 synthetic vehicle-trip-load pairs (90,000 generated, 72000 train / 18000 test, stratified 80/20 split).
- Positive label rate: 0.6048

## Final model (v2)
- Winning family: **gradient_boosting**, wrapped in `CalibratedClassifierCV` (isotonic, 3-fold).
- Features: the same 7 domain factors matching.js computes (route
  compatibility, capacity utilization, timing, cargo/vehicle fit, detour
  efficiency, profitability, reliability), plus supporting raw numbers
  (distances, detour km, slack/lead hours, price per tonne-km) and
  categorical vehicle/cargo types. `rule_match_score` was deliberately
  excluded as an input feature -- see the module docstring for why.

## Test-set metrics (on held-out synthetic data, v2 final model)
- Accuracy: 0.7315
- Precision: 0.7197
- Recall: 0.9107
- F1: 0.804
- ROC-AUC: 0.7691
- Brier score (lower is better-calibrated): 0.1803
- Confusion matrix [[TN, FP], [FN, TP]]: [[3252, 3861], [972, 9915]]

## Context for those numbers
- A naive "always predict the majority class" baseline gets 0.6048 accuracy
  on this same test set -- the trained model's accuracy (0.7315) should
  be read relative to that floor, not in isolation.
- The trained model's predictions agree with the existing rule-based engine's
  own pass/fail line (rule_match_score >= 50) on 0.7752 of
  test-set pairs. Less than 100% is expected and intentional: the two engines
  are built to capture related but different things (see module docstring).
- There is a real, intentional ceiling on how high these numbers can go: the
  synthetic label includes injected random noise standing in for real-world
  unpredictability (see generate_dataset.py). Pushing accuracy much higher
  than this would require either reducing that noise (which would make the
  synthetic task unrealistically easy and defeat its own purpose) or adding a
  feature that encodes the label generator's own hidden formula (which would
  be leaking the answer, not learning). This report reflects the honest
  result of a real, bounded hyperparameter search instead.

## How this is served
A Flask microservice (app.py) loads this file and feature_schema.json, computes
the same features from raw vehicle/trip/load JSON, and returns a calibrated
probability. The Node backend calls it as an optional, best-effort signal
alongside -- never instead of -- the existing explainable rule-based score.
