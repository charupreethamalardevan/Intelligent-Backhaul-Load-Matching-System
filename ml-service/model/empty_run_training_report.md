# IBLMS ML Module 4 -- Empty-Run Risk Prediction Training Report (v1)

**IMPORTANT CAVEAT:** this model is trained and evaluated entirely on
SYNTHETIC data (see generate_empty_run_dataset.py), not real completed-trip
backhaul outcomes -- IBLMS has no real history of which trips actually ended
empty yet. The numbers below describe how well the model learned the
synthetic label-generating process, not how well it will predict real-world
empty-run outcomes. This report exists so that claim is never overstated
(Development Rule 8).

## What this model predicts

The probability that a vehicle's planned trip ends without a backhaul load
booked ("Empty-run risk: 78%"), from the vehicle's type/capacity, the trip's
source/destination/distance, the day-of-week and time-of-year the vehicle
becomes available, and -- the one feature that is genuinely live at serving
time, not synthetic -- how many compatible open loads currently exist near
the trip's destination (`compatible_loads_nearby_count`, computed by
backend/routes/insights.js from real Load documents using the same
radius-based query as the existing `GET /api/loads/near`). There is no prior
rule-based estimate of this signal anywhere in the project to compare
against or build on top of (unlike Modules 1 and 2) -- this is a new signal
IBLMS has never computed before.

### Model selection (3-fold CV on a 18000-row training subsample, scored by ROC-AUC)
- gradient_boosting: CV ROC-AUC 0.7571 <- selected
- hist_gradient_boosting: CV ROC-AUC 0.7536
- random_forest: CV ROC-AUC 0.7497

### Calibration's own effect (isolated from the hyperparameter search)
- Before calibration: ROC-AUC 0.7571, Brier score 0.1793
- After calibration: ROC-AUC 0.7575, Brier score 0.179
(Calibration mainly targets Brier score -- how trustworthy the probability
numbers themselves are, which matters here since the UI shows the raw
percentage directly, not just a pass/fail line -- not the ranking quality
ROC-AUC measures, so a small or even slightly negative AUC change here is
expected; the Brier improvement is the one that matters.)

## Dataset
- 90000 synthetic vehicle-trip samples (90,000 generated, 72000 train / 18000 test, stratified 80/20 split).
- Positive label rate (empty-run rate): 0.6773

## Final model (v1)
- Winning family: **gradient_boosting**, wrapped in `CalibratedClassifierCV` (isotonic, 3-fold).
- Features: vehicle type and capacity, trip source/destination (categorical,
  so the model can learn a per-city effect independently of the hidden
  synthetic popularity tier used only to generate the label), trip distance,
  cyclical day-of-week/day-of-year features for the vehicle's availableFrom
  date, and the live-computed compatible-loads-nearby count.

## Test-set metrics (on held-out synthetic data)
- Accuracy: 0.7272
- Precision: 0.753
- Recall: 0.8887
- F1: 0.8153
- ROC-AUC: 0.7575
- Brier score (lower is better-calibrated): 0.179
- Confusion matrix [[TN, FP], [FN, TP]]: [[2256, 3553], [1357, 10834]]

## Context for those numbers
- A naive "always predict the majority class" baseline gets 0.6773 accuracy
  on this same test set -- the trained model's accuracy (0.7272) should
  be read relative to that floor, not in isolation. There is no existing
  rule-based empty-run estimate to compare against (unlike Modules 1 and 2),
  since this signal did not exist in IBLMS before this module.
- There is a real, intentional ceiling on how high these numbers can go: the
  synthetic label includes injected random noise standing in for real-world
  unpredictability (see generate_empty_run_dataset.py), and the hidden
  per-city popularity tier that biases the label is deliberately NOT given
  to the model as a feature -- only the real, live-computable
  compatible_loads_nearby_count signal is. Pushing accuracy much higher than
  this would require either reducing that noise (which would make the
  synthetic task unrealistically easy and defeat its own purpose) or leaking
  the hidden tier into the feature set (which would be copying the answer,
  not learning). This report reflects the honest result of a real, bounded
  hyperparameter search instead, consistent with how Modules 1-3 were
  evaluated.

## How this is served
The same Flask microservice (app.py) that serves Modules 1-3 also loads this
file and empty_run_feature_schema.json, computes the same features from raw
vehicle/trip JSON plus a live compatible-loads-nearby count, and returns a
calibrated empty-run risk percentage and a Low/Medium/High risk level. The
Node backend calls it as an optional, best-effort signal -- on failure the
UI simply omits the risk estimate for that trip, exactly like every other ML
module in this project.
