"""
train_demand_model.py -- trains and evaluates IBLMS ML Module 3 (Demand
Forecasting) on the synthetic dataset produced by generate_demand_dataset.py.

Predicts a continuous 7-day-ahead load count for a given route
(origin -> destination, from a given anchor date), the same regression-
then-bucket shape as the spec's own worked example ("Predicted demand next 7
days: High") -- the UI shows BOTH the raw count and the Low/Medium/High
category, the category being three fixed thresholds derived from this
dataset's own label distribution (saved alongside the model, see
DEMAND_CATEGORY_THRESHOLDS below) rather than a second, separately-trained
classifier -- one regression target, two presentations of it.

Same bounded, cross-validated RandomizedSearchCV pattern as Module 2
(train_profitability_model.py): three regressor families, a stratified-ish
subsample for the search (2-CPU-core sandbox), a final fit on the full
training split.

Output: model/demand_model.joblib, model/demand_feature_schema.json,
model/demand_category_thresholds.json, model/demand_training_report.md.
"""

import json
import time

import numpy as np
import pandas as pd
import joblib
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import GradientBoostingRegressor, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split, RandomizedSearchCV, KFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

NUMERIC_FEATURES = [
    "distance_km", "dow_sin", "dow_cos", "doy_sin", "doy_cos",
    "recent_load_count_14d", "recent_load_count_30d",
]
CATEGORICAL_FEATURES = ["origin", "destination", "is_weekend"]
LABEL_COL = "predicted_load_count_7d"
# Explicitly excluded from X: row_id, route_weight (the hidden synthetic
# popularity tier the label generator uses -- see generate_demand_dataset.py's
# module docstring for why that stays out of the feature set), anchor_date
# (already distilled into the cyclical dow/doy features).

RANDOM_STATE = 42


def load_data(path="data/synthetic_demand.csv"):
    return pd.read_csv(path)


def build_preprocessor():
    # sparse_output=False: this sandbox's scikit-learn (1.9.x) requires dense
    # input for HistGradientBoostingRegressor, which a sparse OneHotEncoder
    # output would fail with 18 cities x 2 columns one-hot is tiny either way.
    return ColumnTransformer([
        ("num", StandardScaler(), NUMERIC_FEATURES),
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL_FEATURES),
    ])


CANDIDATES = {
    "gradient_boosting": (
        GradientBoostingRegressor(random_state=RANDOM_STATE),
        {
            "reg__n_estimators": [80, 120, 160],
            "reg__max_depth": [2, 3, 4],
            "reg__learning_rate": [0.05, 0.08, 0.12],
            "reg__subsample": [0.8, 1.0],
            "reg__min_samples_leaf": [10, 30],
        },
        4,
    ),
    "hist_gradient_boosting": (
        HistGradientBoostingRegressor(random_state=RANDOM_STATE),
        {
            "reg__max_iter": [150, 250, 350],
            "reg__max_depth": [None, 4, 7, 10],
            "reg__learning_rate": [0.03, 0.06, 0.1, 0.15],
            "reg__l2_regularization": [0.0, 0.1, 1.0],
            "reg__max_leaf_nodes": [15, 31, 63],
        },
        6,
    ),
    "random_forest": (
        RandomForestRegressor(random_state=RANDOM_STATE, n_jobs=-1),
        {
            "reg__n_estimators": [150, 250],
            "reg__max_depth": [8, 12, 16],
            "reg__min_samples_leaf": [5, 20],
            "reg__max_features": ["sqrt", 0.5],
        },
        4,
    ),
}

SEARCH_SUBSAMPLE_SIZE = 18000


def run_search(name, estimator, param_dist, n_iter, X_search, y_search, cv):
    pipeline = Pipeline([("pre", build_preprocessor()), ("reg", estimator)])
    search = RandomizedSearchCV(
        pipeline, param_dist, n_iter=n_iter, scoring="neg_mean_absolute_error", cv=cv,
        random_state=RANDOM_STATE, n_jobs=-1, refit=False,
    )
    t0 = time.time()
    search.fit(X_search, y_search)
    elapsed = time.time() - t0
    print(f"[{name}] best CV MAE = {-search.best_score_:.3f} loads ({elapsed:.1f}s, {n_iter} candidates x {cv.get_n_splits()}-fold, n={len(X_search)})")
    print(f"[{name}] best params: {search.best_params_}")
    return search


def main():
    df = load_data()
    feature_cols = NUMERIC_FEATURES + CATEGORICAL_FEATURES
    X = df[feature_cols]
    y = df[LABEL_COL]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=RANDOM_STATE)
    cv = KFold(n_splits=3, shuffle=True, random_state=RANDOM_STATE)

    X_search, _, y_search, _ = train_test_split(
        X_train, y_train, train_size=SEARCH_SUBSAMPLE_SIZE, random_state=RANDOM_STATE,
    )

    searches = {}
    for name, (estimator, param_dist, n_iter) in CANDIDATES.items():
        searches[name] = run_search(name, estimator, param_dist, n_iter, X_search, y_search, cv)

    best_name = max(searches, key=lambda n: searches[n].best_score_)
    best_search = searches[best_name]
    best_estimator_class = CANDIDATES[best_name][0].__class__
    best_params = {k.replace("reg__", ""): v for k, v in best_search.best_params_.items()}
    print(f"\nSelected model family: {best_name} (CV MAE on {SEARCH_SUBSAMPLE_SIZE}-row subsample: {-best_search.best_score_:.3f} loads)")

    best_reg = best_estimator_class(random_state=RANDOM_STATE, **({"n_jobs": -1} if best_name == "random_forest" else {}))
    best_reg.set_params(**best_params)
    final_pipeline = Pipeline([("pre", build_preprocessor()), ("reg", best_reg)])
    t0 = time.time()
    final_pipeline.fit(X_train, y_train)
    fit_elapsed = time.time() - t0
    print(f"Final fit on full {len(X_train)}-row training split in {fit_elapsed:.1f}s")

    pred_test = final_pipeline.predict(X_test)
    pred_test_clamped = np.clip(pred_test, 0, None)

    metrics = {
        "n_train": len(X_train),
        "n_test": len(X_test),
        "mae": round(mean_absolute_error(y_test, pred_test_clamped), 3),
        "rmse": round(float(np.sqrt(mean_squared_error(y_test, pred_test_clamped))), 3),
        "r2": round(r2_score(y_test, pred_test_clamped), 4),
    }

    dummy = DummyRegressor(strategy="mean").fit(X_train, y_train)
    dummy_pred = dummy.predict(X_test)
    baseline_mean_mae = round(mean_absolute_error(y_test, dummy_pred), 3)

    # A second, more telling baseline: predict the TRAINING MEAN for that
    # exact origin-destination route (a "simple per-route lookup table", no
    # model at all) -- this is the honest bar the trained model needs to
    # clear, since route identity alone already carries real signal.
    train_full = X_train.copy()
    train_full["y"] = y_train.values
    route_means = train_full.groupby(["origin", "destination"])["y"].mean()
    overall_mean = y_train.mean()
    route_lookup_pred = X_test.apply(lambda r: route_means.get((r["origin"], r["destination"]), overall_mean), axis=1)
    route_lookup_mae = round(mean_absolute_error(y_test, route_lookup_pred), 3)

    cv_summary = "\n".join(
        f"- {name}: CV MAE {-searches[name].best_score_:.3f} loads" + (" <- selected" if name == best_name else "")
        for name in searches
    )

    joblib.dump(final_pipeline, "model/demand_model.joblib")

    feature_schema = {
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "notes": "is_weekend is the string 'True'/'False', matching the anchor date's own weekday.",
    }
    with open("model/demand_feature_schema.json", "w") as f:
        json.dump(feature_schema, f, indent=2)

    # Category thresholds: tertiles of this dataset's own label distribution
    # (not of the model's predictions -- the thresholds describe what "a
    # busy route" means across the whole synthetic population, independent
    # of how well any one model predicts it).
    sorted_labels = np.sort(y.values)
    low_max = round(float(sorted_labels[int(len(sorted_labels) * 0.33)]), 2)
    medium_max = round(float(sorted_labels[int(len(sorted_labels) * 0.66)]), 2)
    thresholds = {
        "lowMax": low_max,
        "mediumMax": medium_max,
        "notes": "predicted_load_count_7d <= lowMax => Low; <= mediumMax => Medium; above => High. Tertiles of the training dataset's own label distribution.",
    }
    with open("model/demand_category_thresholds.json", "w") as f:
        json.dump(thresholds, f, indent=2)

    report = f"""# IBLMS ML Module 3 -- Demand Forecasting Training Report (v1)

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

### Model selection ({cv.get_n_splits()}-fold CV on a {SEARCH_SUBSAMPLE_SIZE}-row training subsample, scored by MAE)
{cv_summary}

## Dataset
- {metrics['n_train'] + metrics['n_test']} synthetic route/date samples (90,000 generated, {metrics['n_train']} train / {metrics['n_test']} test, 80/20 split).
- Label mean {round(float(y.mean()), 2)} loads/week, range {round(float(y.min()), 1)} .. {round(float(y.max()), 1)}.
- Category thresholds (tertiles of the full label distribution): Low <= {low_max}, Medium <= {medium_max}, High above that.

## Final model (v1)
- Winning family: **{best_name}**.
- Features: route distance, cyclical day-of-week/day-of-year (captures
  weekday and seasonal effects), a weekend flag, and two numbers the real
  Node backend computes LIVE from actual Load documents at serving time --
  how many loads were posted on this exact route in the last 14 and 30 days
  (backend/routes/insights.js). Origin and destination city are also
  categorical features, so the model can learn a per-city effect directly
  from the data. The synthetic "route popularity tier" used only to generate
  the training label (see generate_demand_dataset.py) is NOT a feature.

## Test-set metrics (on held-out synthetic data)
- MAE: {metrics['mae']} loads/week
- RMSE: {metrics['rmse']} loads/week
- R-squared: {metrics['r2']}

## Context for those numbers
- A "predict the dataset-wide mean for everything" baseline gets {baseline_mean_mae} loads/week MAE.
- A "just look up this exact route's training-set average, no model" baseline
  gets {route_lookup_mae} loads/week MAE -- this is the more honest comparison,
  since route identity alone already carries real signal (see origin/
  destination as categorical features above). The trained model's MAE
  ({metrics['mae']}) should be read against this number, not the flat dummy
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
"""
    with open("model/demand_training_report.md", "w") as f:
        f.write(report)

    print(json.dumps(metrics, indent=2))
    print(f"Baseline (predict dataset mean) MAE: {baseline_mean_mae} loads/week")
    print(f"Baseline (per-route lookup table) MAE: {route_lookup_mae} loads/week")
    print(f"Category thresholds: Low <= {low_max}, Medium <= {medium_max}, High above")
    print("Saved model/demand_model.joblib, model/demand_feature_schema.json, model/demand_category_thresholds.json, model/demand_training_report.md")


if __name__ == "__main__":
    main()
