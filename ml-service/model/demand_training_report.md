# IBLMS ML Module 3 -- Demand Forecasting Training Report (v1)

**IMPORTANT CAVEAT:** this model is trained and evaluated entirely on
SYNTHETIC data (see generate_demand_dataset.py), not real multi-month
load-posting history -- IBLMS has no real historical demand data yet. The
numbers below describe how well the model learned the synthetic label
-generating process, not how well it will forecast real-world demand. This
report exists so that claim is never overstated (Development Rule 8).

## What this model predicts

A continuous "predicted load count in the next 7 days" for a given route
(origin -> destination) and anchor date, matching the spec's own worked
example ("Route: Madurai -> Chennai, Predicted demand next 7 days: High") --
the Low/Medium/High category shown in the UI is this same number bucketed by
the tertile thresholds in demand_category_thresholds.json, not a second
model.

### Model selection (3-fold CV on a 18000-row training subsample, scored by MAE)
- gradient_boosting: CV MAE 1.872 loads
- hist_gradient_boosting: CV MAE 1.812 loads <- selected
- random_forest: CV MAE 2.026 loads

## Dataset
- 90000 synthetic route/date samples (90,000 generated, 72000 train / 18000 test, 80/20 split).
- Label mean 16.2 loads/week, range 0.4 .. 36.9.
- Category thresholds (tertiles of the full label distribution): Low <= 14.04, Medium <= 18.05, High above that.

## Final model (v1)
- Winning family: **hist_gradient_boosting**.
- Features: route distance, cyclical day-of-week/day-of-year (captures
  weekday and seasonal effects), a weekend flag, and two numbers the real
  Node backend computes LIVE from actual Load documents at serving time --
  how many loads were posted on this exact route in the last 14 and 30 days
  (backend/routes/insights.js). Origin and destination city are also
  categorical features, so the model can learn a per-city effect directly
  from the data. The synthetic "route popularity tier" used only to generate
  the training label (see generate_demand_dataset.py) is NOT a feature.

## Test-set metrics (on held-out synthetic data)
- MAE: 1.783 loads/week
- RMSE: 2.233 loads/week
- R-squared: 0.7678

## Context for those numbers
- A "predict the dataset-wide mean for everything" baseline gets 3.727 loads/week MAE.
- A "just look up this exact route's training-set average, no model" baseline
  gets 2.775 loads/week MAE -- this is the more honest comparison,
  since route identity alone already carries real signal (see origin/
  destination as categorical features above). The trained model's MAE
  (1.783) should be read against this number, not the flat dummy
  baseline: a model that only matched the per-route lookup table would be
  adding nothing beyond memorizing route averages, while actually beating it
  means the model is using distance/seasonality/recent-momentum to adjust
  beyond a flat per-route number.
- There is a real, intentional ceiling on how low this MAE can go: the
  synthetic label includes injected random noise (standing in for real-world
  unpredictability) that no amount of feature engineering can remove, by
  design -- exactly the same honesty pattern Modules 1 and 2 use.

## How this is served
The same Flask microservice (app.py) that serves Modules 1 and 2 also loads
this file, demand_feature_schema.json, and demand_category_thresholds.json.
backend/routes/insights.js (new) computes the two real "recent load count"
numbers from actual Load documents, sends them plus the route and anchor
date to the service, and returns the predicted count and category to the
frontend -- there is no existing rule-based demand estimate in this project
to show alongside it, so this module's entire output is the ML prediction
(clearly labelled as such, same synthetic-data disclosure as Modules 1/2).
