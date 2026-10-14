# IBLMS ML Microservice -- Module 1 (Match/Compatibility) + Module 2 (Profitability)

A small Python microservice, served over HTTP, that runs TWO independent
trained models alongside the existing Node/Express backend:

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

Both run in this one Flask process (`app.py`), so running this project still
means exactly one extra long-running process alongside the two `npm run
dev`s -- not two.

**Why it's separate from the backend:** the project's own spec (section 17)
calls for Python + scikit-learn for the ML layer and Node/Express for the
backend. Rather than hand-port scikit-learn's trained models into JavaScript,
this keeps them in their native Python environment and the Node backend
calls them over plain HTTP.

**Why the training data is synthetic, for both modules:** IBLMS has no real
historical accept/reject outcomes or completed-trip P&L yet to learn from.
`generate_dataset.py` / `generate_profitability_dataset.py` each build a
large realistic population of candidate pairings (using the project's own
city list, vehicle types and cargo types) and a deliberately-noisy proxy
label -- see the docstring at the top of each file for exactly how and why.
This is disclosed everywhere either model's output is shown, including in
the UI badges themselves.

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
```

Read `model/training_report.md` and `model/profitability_training_report.md`
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
running, or it's slow, or it errors, the Node backend simply skips whichever
ML signal was requested and the corresponding rule-based score keeps working
exactly as before -- nothing breaks, the "ML Compatibility" / "ML Profit
Forecast" badges just don't appear in the UI for that request.

## Endpoints

- `GET /health` -- `{ status, modelVersion, profitabilityStatus, profitabilityModelVersion }`
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

## Retraining

Re-run `python generate_dataset.py && python train_model.py` (Module 1) or
`python generate_profitability_dataset.py && python train_profitability_model.py`
(Module 2) any time -- each pair is deterministic (seeded) but will pick up
any changes you make to that module's generation or feature logic. Each model
file is versioned by its own `*_VERSION` string in `app.py`; bump the
relevant one if you change that module's feature schema so stale clients can
tell.
