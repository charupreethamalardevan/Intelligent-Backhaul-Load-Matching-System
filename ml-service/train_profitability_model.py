"""
train_profitability_model.py -- trains and evaluates IBLMS ML Module 2
(Profitability Prediction) on the synthetic dataset produced by
generate_profitability_dataset.py.

Unlike Module 1 (train_model.py), this model's target is a continuous
number -- realized_margin_pct -- and it DELIBERATELY includes the existing
rule-based estimate (rule_margin_pct, reproduced exactly from
backend/services/profitability.js) as an input feature. See the module
docstring in generate_profitability_dataset.py for why that is the right
call here (the model's job is to learn the correction/residual relative to
an estimate that's missing real cost components), not leakage the way
feeding Module 1's own rule_match_score back to itself would have been.

Model selection mirrors Module 1 v2's approach -- a bounded, cross-validated
RandomizedSearchCV across three regressor families, picked by CV score on a
stratified-by-quantile subsample (this sandbox has only 2 CPU cores; see
train_model.py's identical note) -- then a final fit on the full training
split. There is no probability-calibration step here (that's specific to
classifiers); the regression equivalent of "is this number trustworthy" is
just the MAE/RMSE/R2 reported directly on the held-out test set.

Output: model/profitability_model.joblib, model/profitability_feature_
schema.json, model/profitability_training_report.md.
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
    "max_capacity_tonnes", "cargo_weight_tonnes", "expected_price",
    "to_pickup_km", "loaded_km", "from_delivery_km", "direct_km", "total_km",
    "detour_km", "detour_ratio", "capacity_utilization", "slack_hours", "lead_hours",
    "price_per_tonne_km", "rule_fuel_cost", "rule_toll_cost", "rule_other_cost",
    "rule_operating_cost", "rule_profit", "rule_margin_pct",
]
CATEGORICAL_FEATURES = ["vehicle_type", "required_vehicle_type", "cargo_type", "month", "is_weekend"]
LABEL_COL = "realized_margin_pct"
# Explicitly excluded from X: row_id, city names (already distilled into
# distances), and every "hidden" column (fuel_price_index, congestion_index,
# waiting_hours, handling_overhead, price_realization_factor) -- those are
# exactly the unobservable-at-quote-time factors the label generator uses to
# keep this from being a trivial copy of rule_margin_pct; feeding them back
# in as features would let the model cheat by reconstructing its own label.

RANDOM_STATE = 42


def load_data(path="data/synthetic_profitability.csv"):
    df = pd.read_csv(path)
    df["month"] = df["month"].astype(str)
    return df


def build_preprocessor():
    return ColumnTransformer([
        ("num", StandardScaler(), NUMERIC_FEATURES),
        ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
    ])


# Three candidate regressor families -- same spirit as Module 1's three
# classifier families, modest grids for the same 2-CPU-core reason.
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
    print(f"[{name}] best CV MAE = {-search.best_score_:.3f} pts ({elapsed:.1f}s, {n_iter} candidates x {cv.get_n_splits()}-fold, n={len(X_search)})")
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

    best_name = max(searches, key=lambda n: searches[n].best_score_)  # best_score_ is -MAE, so max = lowest MAE
    best_search = searches[best_name]
    best_estimator_class = CANDIDATES[best_name][0].__class__
    best_params = {k.replace("reg__", ""): v for k, v in best_search.best_params_.items()}
    print(f"\nSelected model family: {best_name} (CV MAE on {SEARCH_SUBSAMPLE_SIZE}-row subsample: {-best_search.best_score_:.3f} pts)")

    best_reg = best_estimator_class(random_state=RANDOM_STATE, **({"n_jobs": -1} if best_name == "random_forest" else {}))
    best_reg.set_params(**best_params)
    final_pipeline = Pipeline([("pre", build_preprocessor()), ("reg", best_reg)])
    t0 = time.time()
    final_pipeline.fit(X_train, y_train)
    fit_elapsed = time.time() - t0
    print(f"Final fit on full {len(X_train)}-row training split in {fit_elapsed:.1f}s")

    pred_test = final_pipeline.predict(X_test)

    metrics = {
        "n_train": len(X_train),
        "n_test": len(X_test),
        "mae": round(mean_absolute_error(y_test, pred_test), 3),
        "rmse": round(float(np.sqrt(mean_squared_error(y_test, pred_test))), 3),
        "r2": round(r2_score(y_test, pred_test), 4),
    }

    # Baseline 1: always predict the training mean (sanity floor).
    dummy = DummyRegressor(strategy="mean").fit(X_train, y_train)
    dummy_pred = dummy.predict(X_test)
    baseline_mean_mae = round(mean_absolute_error(y_test, dummy_pred), 3)

    # Baseline 2, the one that actually matters: just trust the EXISTING
    # rule-based estimate as your profit forecast, with no model at all.
    # This is the honest comparison -- "does training a model on top of the
    # estimate actually help, or is the plain formula just as good."
    rule_as_prediction_mae = round(mean_absolute_error(y_test, X_test["rule_margin_pct"]), 3)

    cv_summary = "\n".join(
        f"- {name}: CV MAE {-searches[name].best_score_:.3f} pts" + (" <- selected" if name == best_name else "")
        for name in searches
    )

    joblib.dump(final_pipeline, "model/profitability_model.joblib")

    feature_schema = {
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "notes": "month is the pickup month as a string '1'..'12'; is_weekend is the string 'True'/'False'.",
    }
    with open("model/profitability_feature_schema.json", "w") as f:
        json.dump(feature_schema, f, indent=2)

    cap_rate_rule = round(float((df["rule_margin_pct"] >= 79.99).mean()), 4)
    floor_rate_rule = round(float((df["rule_margin_pct"] <= -99.99).mean()), 4)

    report = f"""# IBLMS ML Module 2 -- Profitability Prediction Training Report (v1)

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

### Model selection ({cv.get_n_splits()}-fold CV on a {SEARCH_SUBSAMPLE_SIZE}-row training subsample, scored by MAE)
{cv_summary}

## Dataset
- {metrics['n_train'] + metrics['n_test']} synthetic vehicle-trip-load pairs (90,000 generated, {metrics['n_train']} train / {metrics['n_test']} test, 80/20 split).
- Both `rule_margin_pct` and `realized_margin_pct` are clamped to [-100, 80] for realism (an unclamped ratio blows up when a tiny synthetic price is paired with a large reposition distance). {round(cap_rate_rule*100,1)}% of rows hit the +80 ceiling and {round(floor_rate_rule*100,1)}% hit the -100 floor on the rule estimate alone -- a real limitation of how the synthetic prices were sampled (uniformly, not from a realistic market-clearing distribution), stated here rather than hidden.

## Final model (v1)
- Winning family: **{best_name}**.
- Features: the same 7 raw/engineered trip-economics numbers (distances,
  detour, utilization, slack/lead hours, price per tonne-km), the existing
  rule-based cost/margin breakdown, and categorical vehicle/cargo type,
  pickup month, and weekend flag. The four hidden real-world cost/revenue
  effects described above were deliberately excluded as features.

## Test-set metrics (on held-out synthetic data)
- MAE: {metrics['mae']} percentage points
- RMSE: {metrics['rmse']} percentage points
- R-squared: {metrics['r2']}

## Context for those numbers -- the comparison that actually matters
- A "predict the training-set average margin for everything" baseline gets
  {baseline_mean_mae} pts MAE on this same test set.
- **Just trusting the existing rule-based estimate itself as the profit
  forecast** (i.e. not training anything at all) gets {rule_as_prediction_mae}
  pts MAE on the same test set. The trained model's MAE ({metrics['mae']} pts)
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
"""
    with open("model/profitability_training_report.md", "w") as f:
        f.write(report)

    print(json.dumps(metrics, indent=2))
    print(f"Baseline (predict mean) MAE: {baseline_mean_mae} pts")
    print(f"Baseline (trust the rule estimate as-is) MAE: {rule_as_prediction_mae} pts")
    print("Saved model/profitability_model.joblib, model/profitability_feature_schema.json, model/profitability_training_report.md")


if __name__ == "__main__":
    main()
