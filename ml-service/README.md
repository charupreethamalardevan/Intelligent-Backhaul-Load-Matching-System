# IBLMS ML Microservice -- all 4 spec ML modules

A small Python microservice, served over HTTP, that runs all FOUR of the
project's trained models alongside the existing Node/Express backend:

- **Module 1 (Match/Compatibility Prediction):** a trained classifier that
  predicts the probability a given truck-load pairing is a good match. The
  existing rule-based scoring in `backend/services/matching.js` is untouched
  and keeps working on its own whether or not this service is running.
- **Module 2 (Profitability Prediction), added in Addendum 36:** a trained
  regressor that predicts a realized profit margin %, correcting for cost
  components (cargo handling overhead, dock waiting time, fuel/toll variance,
  price realization) the existing rule-based estimate in
  `backend/services/profitability.js` has no way to see. That existing
  estimate is, likewise, untouched.
- **Module 3 (Demand Forecasting), added in Addendum 39:** a trained
  regressor that predicts a 7-day-ahead load count for a route
  (origin -> destination), shown as both the raw number and a Low/Medium/High
  category derived from this dataset's own tertile thresholds. This is a new
  signal -- IBLMS has no prior estimate of route demand to compare against.
- **Module 4 (Empty-Run Risk Prediction), added in Addendum 39:** a
  calibrated classifier that predicts the probability a vehicle's planned
  trip ends without a backhaul load booked ("Empty-run risk: 78%"), from the
  vehicle, the trip, and a live count of compatible open loads near the
  trip's destination. Also a brand-new signal.

All four run in this one Flask process (`app.py`), so running this project
still means exactly one extra long-running process alongside the two `npm
run dev`s -- not four.

**Why it's separate from the backend:** the project's own spec (section 17)
calls for Python + scikit-learn for the ML layer and Node/Express for the
backend. Rather than hand-port scikit-learn's trained models into JavaScript,
this keeps them in their native Python environment and the Node backend
calls them over plain HTTP.

**Why the training data is synthetic, for all four modules:** IBLMS has no
real historical accept/reject outcomes, completed-trip P&L, multi-month load
-posting history, or completed-trip backhaul outcomes yet to learn from.
Each `generate_*_dataset.py` script builds a large realistic population of
samples (using the project's own city list, vehicle types and cargo types)
and a deliberately-noisy proxy label -- see the docstring at the top of each
file for exactly how and why. This is disclosed everywhere any model's
output is shown, including in the UI badges themselves.

Modules 3 and 4 each have one feature that is NOT synthetic at serving
time -- Module 3's recent-load-count-on-this-route, and Module 4's
compatible-loads-near-the-destination -- both computed live from real Load
documents by `backend/routes/insights.js`. Only the TRAINING values for
those two columns are synthesized, the same way every other ML module in
this project synthesizes training data for a live, real-feature input.

## One-time setup

```bash
cd ml-service
python -m venv .venv        # optional but recommended
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python generate_dataset.py                # Module 1 data (~20MB, a few seconds)
python train_model.py                      # Module 1 model + training_report.md

python generate_profitability_dataset.py   # Module 2 data
python train_profitability_model.py        # Module 2 model + profitability_training_report.md

python generate_demand_dataset.py          # Module 3 data
python train_demand_model.py                # Module 3 model + demand_training_report.md

python generate_empty_run_dataset.py       # Module 4 data
python train_empty_run_model.py              # Module 4 model + empty_run_training_report.md
```

Read `model/training_report.md`, `model/profitability_training_report.md`,
`model/demand_training_report.md`, and `model/empty_run_training_report.md`
afterwards -- each states the real evaluation numbers and the synthetic-data
caveat in plain language.

## Running the service

```bash
python app.py
```

Starts on **http://localhost:5001** by default (override with the
`ML_SERVICE_PORT` env var). Leave this running in its own terminal alongside
`npm run dev` in both `backend/` and `frontend/` -- three processes total.

The Node backend looks for it at `http://localhost:5001` by default too
(override with `ML_SERVICE_URL` in `backend/.env`). If this service isn't
running, or it's slow, or it errors, or a particular model file failed to
load (including a scikit-learn-version mismatch -- each model load is
wrapped so that degrades just that one endpoint, never the whole process),
the Node backend simply skips whichever ML signal was requested and the
corresponding rule-based score / UI panel keeps working exactly as before --
nothing breaks, the relevant badge or panel just doesn't appear for that
request.

## Endpoints

- `GET /health` -- `{ status, modelVersion, profitabilityStatus, profitabilityModelVersion, demandStatus, demandModelVersion, emptyRunStatus, emptyRunModelVersion }`
- `POST /predict` -- body `{ vehicle, trip, load, ownerRatingAvg? }` (the
  same shapes already used elsewhere in the backend), returns
  `{ eligible, probability, modelVersion }` or `{ eligible: false, reason }`.
- `POST /predict-batch` -- body `{ items: [{ id, vehicle, trip, load, ownerRatingAvg? }, ...] }`,
  returns `{ predictions: [{ id, eligible, probability?, reason? }, ...] }`
  in the same order. The Node backend uses this one so a whole ranked list
  only costs a single HTTP round trip.
- `POST /predict-profitability` -- body `{ vehicle, trip, load }`, returns
  `{ eligible, ruleEstimate, predictedMarginPct, predictedProfit, modelVersion }`
  or `{ eligible: false, reason }`.
- `POST /predict-profitability-batch` -- body `{ items: [{ id, vehicle, trip, load }, ...] }`,
  returns `{ predictions: [{ id, eligible, predictedMarginPct?, predictedProfit?, reason? }, ...] }`.
  The Node backend uses this one for ranked lists, same as `/predict-batch`.
- `POST /predict-demand` -- body `{ origin, destination, anchorDate, recentLoadCount14d, recentLoadCount30d }`,
  returns `{ eligible, predictedLoadCount7d, demandCategory, modelVersion }`
  or `{ eligible: false, reason }`. `origin`/`destination` must be one of
  IBLMS's known cities; `recentLoadCount14d/30d` are computed live by the
  Node backend from real Load documents on that exact route.
- `POST /predict-empty-run-risk` -- body `{ vehicle, tripSource, tripDestination, availableFrom, compatibleLoadsNearbyCount }`,
  returns `{ eligible, emptyRunRiskPct, riskLevel, modelVersion }` or
  `{ eligible: false, reason }`. `compatibleLoadsNearbyCount` is computed
  live by the Node backend using the same radius-based query as the existing
  `GET /api/loads/near`.
- `POST /predict-empty-run-risk-batch` -- body `{ items: [{ id, vehicle, tripSource, tripDestination, availableFrom, compatibleLoadsNearbyCount }, ...] }`,
  returns `{ predictions: [{ id, eligible, emptyRunRiskPct?, riskLevel?, reason? }, ...] }`.
  The Node backend uses this one to score every one of a Fleet Owner's
  available trips in a single HTTP round trip.

## Retraining

Re-run the matching `generate_*_dataset.py && train_*.py` pair for whichever
module any time -- each pair is deterministic (seeded) but will pick up any
changes you make to that module's generation or feature logic. Each model
file is versioned by its own `*_VERSION` string in `app.py`; bump the
relevant one if you change that module's feature schema so stale clients can
tell.
