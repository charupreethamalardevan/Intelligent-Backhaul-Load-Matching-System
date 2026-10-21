"""
train_empty_run_model.py -- trains and evaluates IBLMS ML Module 4
(Empty-Run Risk Prediction) on the synthetic dataset produced by
generate_empty_run_dataset.py.

Mirrors train_model.py's (Module 1's) approach exactly, since this is also a
binary classification task where the trustworthiness of the probability
number itself matters (the UI shows "Empty-run risk: 78%", not just a
pass/fail line):

1. Model/hyperparameter selection via cross-validated RandomizedSearchCV
   across three model families (GradientBoosting, HistGradientBoosting,
   RandomForest), on a stratified subsample for the same 2-CPU-core sandbox
   reason documented in train_model.py.
2. Probability calibration (CalibratedClassifierCV, isotonic) on top of the
   winning model's hyperparameters, fit on the full training split.

Feature design: `compatible_loads_nearby_count` -- the one feature that, at
serving time, is computed live from real open Load documents near the
trip's destination (see generate_empty_run_dataset.py's module docstring) --
plus the vehicle's type/capacity, trip source/destination (categorical, so
the model can learn a per-city effect independent of the hidden synthetic
CITY_WEIGHT tier that generated the label), trip distance, and cyclical
day-of-week/day-of-year features for the vehicle's availableFrom date.
Deliberately excluded: row_id, dest_weight (the hidden synthetic tier used
only to generate the label -- feeding it back in would be leaking the
answer), true_probability (debug only), and the raw available_from string
(already distilled into the cyclical features).

There is no existing rule-based "empty-run risk" estimate anywhere in this
project to compare against (unlike Module 1's rule_match_score or Module 2's
rule_margin_pct) -- IBLMS has never computed this signal at all before this
module, so the only honest baseline here is the majority-class rate.

Output: model/empty_run_model.joblib (a calibrated scikit-learn estimator),
model/empty_run_feature_schema.json, model/empty_run_training_report.md.
"""

import json
import time

import numpy as np
import pandas as pd
import joblib
from sklearn.base import clone
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    roc_auc_score, confusion_matrix, brier_score_loss,
)
from sklearn.model_selection import train_test_split, RandomizedSearchCV, StratifiedKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

NUMERIC_FEATURES = [
    "max_capacity_tonnes", "distance_km", "dow_sin", "dow_cos", "doy_sin",
    "doy_cos", "compatible_loads_nearby_count",
]
CATEGORICAL_FEATURES = ["vehicle_type", "trip_source", "trip_destination", "is_weekend"]
LABEL_COL = "empty_run_label"
# Explicitly excluded from X: row_id, dest_weight (hidden synthetic tier used
# only to generate the label), true_probability (debug only), available_from
# (raw string, already distilled into the cyclical dow/doy features).

RANDOM_STATE = 42


def load_data(path="data/synthetic_empty_run.csv"):
    df = pd.read_csv(path)
    return df


def build_preprocessor():
    # sparse_output=False: this sandbox's scikit-learn (1.9.x) requires dense
    # input for HistGradientBoostingClassifier, which a sparse OneHotEncoder
    # output would fail with -- 19 cities x 2 columns + vehicle type one-hot
    # is tiny either way.
    return ColumnTransformer([
        ("num", StandardScaler(), NUMERIC_FEATURES),
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL_FEATURES),
    ])


# Three candidate model families, same spirit (and same modest grids, for the
# same 2-CPU-core sandbox reason) as train_model.py's CANDIDATES.
CANDIDATES = {
    "gradient_boosting": (
        GradientBoostingClassifier(random_state=RANDOM_STATE),
        {
            "clf__n_estimators": [80, 120, 160],
            "clf__max_depth": [2, 3, 4],
            "clf__learning_rate": [0.05, 0.08, 0.12],
            "clf__subsample": [0.8, 1.0],
            "clf__min_samples_leaf": [10, 30],
        },
        4,
    ),
    "hist_gradient_boosting": (
        HistGradientBoostingClassifier(random_state=RANDOM_STATE),
        {
            "clf__max_iter": [150, 250, 350],
            "clf__max_depth": [None, 4, 7, 10],
            "clf__learning_rate": [0.03, 0.06, 0.1, 0.15],
            "clf__l2_regularization": [0.0, 0.1, 1.0],
            "clf__max_leaf_nodes": [15, 31, 63],
        },
        6,
    ),
    "random_forest": (
        RandomForestClassifier(random_state=RANDOM_STATE, n_jobs=-1),
        {
            "clf__n_estimators": [150, 250],
            "clf__max_depth": [8, 12, 16],
            "clf__min_samples_leaf": [5, 20],
            "clf__max_features": ["sqrt", 0.5],
        },
        4,
    ),
}

# Search runs on a stratified SUBSAMPLE of the training split, not the full
# 72,000 rows -- see train_model.py's identical note (2 CPU cores in this
# sandbox). The winning model is still calibrated and evaluated on the full
# training/test splits below.
SEARCH_SUBSAMPLE_SIZE = 18000


def run_search(name, estimator, param_dist, n_iter, X_search, y_search, cv):
    pipeline = Pipeline([("pre", build_preprocessor()), ("clf", estimator)])
    search = RandomizedSearchCV(
        pipeline, param_dist, n_iter=n_iter, scoring="roc_auc", cv=cv,
        random_state=RANDOM_STATE, n_jobs=-1, refit=False,
    )
    t0 = time.time()
    search.fit(X_search, y_search)
    elapsed = time.time() - t0
    print(f"[{name}] best CV ROC-AUC = {search.best_score_:.4f} ({elapsed:.1f}s, {n_iter} candidates x {cv.get_n_splits()}-fold, n={len(X_search)})")
    print(f"[{name}] best params: {search.best_params_}")
    return search


def main():
    df = load_data()
    feature_cols = NUMERIC_FEATURES + CATEGORICAL_FEATURES
    X = df[feature_cols]
    y = df[LABEL_COL]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y)
    cv = StratifiedKFold(n_splits=3, shuffle=True, random_state=RANDOM_STATE)

    X_search, _, y_search, _ = train_test_split(
        X_train, y_train, train_size=SEARCH_SUBSAMPLE_SIZE, random_state=RANDOM_STATE, stratify=y_train,
    )

    searches = {}
    for name, (estimator, param_dist, n_iter) in CANDIDATES.items():
        searches[name] = run_search(name, estimator, param_dist, n_iter, X_search, y_search, cv)

    best_name = max(searches, key=lambda n: searches[n].best_score_)
    best_search = searches[best_name]
    best_estimator_class = CANDIDATES[best_name][0].__class__
    best_params = {k.replace("clf__", ""): v for k, v in best_search.best_params_.items()}
    print(f"\nSelected model family: {best_name} (CV ROC-AUC on {SEARCH_SUBSAMPLE_SIZE}-row subsample: {best_search.best_score_:.4f})")

    best_clf = best_estimator_class(random_state=RANDOM_STATE, **({"n_jobs": -1} if best_name == "random_forest" else {}))
    best_clf.set_params(**best_params)
    best_pipeline_unfit = Pipeline([("pre", build_preprocessor()), ("clf", best_clf)])
    calibrated = CalibratedClassifierCV(best_pipeline_unfit, method="isotonic", cv=3)
    t0 = time.time()
    calibrated.fit(X_train, y_train)
    calib_elapsed = time.time() - t0
    print(f"Calibration fit on full {len(X_train)}-row training split in {calib_elapsed:.1f}s")

    proba_test = calibrated.predict_proba(X_test)[:, 1]
    pred_test = (proba_test >= 0.5).astype(int)

    metrics = {
        "n_train": len(X_train),
        "n_test": len(X_test),
        "accuracy": round(accuracy_score(y_test, pred_test), 4),
        "precision": round(precision_score(y_test, pred_test), 4),
        "recall": round(recall_score(y_test, pred_test), 4),
        "f1": round(f1_score(y_test, pred_test), 4),
        "roc_auc": round(roc_auc_score(y_test, proba_test), 4),
        "brier_score": round(brier_score_loss(y_test, proba_test), 4),
    }
    cm = confusion_matrix(y_test, pred_test).tolist()

    majority_class = int(y_train.mean() >= 0.5)
    baseline_pred = np.full_like(y_test, majority_class)
    baseline_acc = round(accuracy_score(y_test, baseline_pred), 4)

    # Isolate calibration's own effect from the hyperparameter search's
    # effect, same as train_model.py: fit the SAME winning hyperparameters
    # with no calibration wrapper, on the same training/test split.
    uncalibrated_pipeline = clone(best_pipeline_unfit)
    uncalibrated_pipeline.fit(X_train, y_train)
    uncalibrated_proba = uncalibrated_pipeline.predict_proba(X_test)[:, 1]
    uncalibrated_brier = round(brier_score_loss(y_test, uncalibrated_proba), 4)
    uncalibrated_auc = round(roc_auc_score(y_test, uncalibrated_proba), 4)

    joblib.dump(calibrated, "model/empty_run_model.joblib")

    feature_schema = {
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "notes": "is_weekend must be the string 'True'/'False' (Python str(bool) form), matching the training data's encoding.",
    }
    with open("model/empty_run_feature_schema.json", "w") as f:
        json.dump(feature_schema, f, indent=2)

    cv_summary = "\n".join(
        f"- {name}: CV ROC-AUC {searches[name].best_score_:.4f}" + (" <- selected" if name == best_name else "")
        for name in searches
    )

    report = f"""# IBLMS ML Module 4 -- Empty-Run Risk Prediction Training Report (v1)

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

### Model selection ({cv.get_n_splits()}-fold CV on a {SEARCH_SUBSAMPLE_SIZE}-row training subsample, scored by ROC-AUC)
{cv_summary}

### Calibration's own effect (isolated from the hyperparameter search)
- Before calibration: ROC-AUC {uncalibrated_auc}, Brier score {uncalibrated_brier}
- After calibration: ROC-AUC {metrics['roc_auc']}, Brier score {metrics['brier_score']}
(Calibration mainly targets Brier score -- how trustworthy the probability
numbers themselves are, which matters here since the UI shows the raw
percentage directly, not just a pass/fail line -- not the ranking quality
ROC-AUC measures, so a small or even slightly negative AUC change here is
expected; the Brier improvement is the one that matters.)

## Dataset
- {metrics['n_train'] + metrics['n_test']} synthetic vehicle-trip samples (90,000 generated, {metrics['n_train']} train / {metrics['n_test']} test, stratified 80/20 split).
- Positive label rate (empty-run rate): {round(y.mean(), 4)}

## Final model (v1)
- Winning family: **{best_name}**, wrapped in `CalibratedClassifierCV` (isotonic, 3-fold).
- Features: vehicle type and capacity, trip source/destination (categorical,
  so the model can learn a per-city effect independently of the hidden
  synthetic popularity tier used only to generate the label), trip distance,
  cyclical day-of-week/day-of-year features for the vehicle's availableFrom
  date, and the live-computed compatible-loads-nearby count.

## Test-set metrics (on held-out synthetic data)
- Accuracy: {metrics['accuracy']}
- Precision: {metrics['precision']}
- Recall: {metrics['recall']}
- F1: {metrics['f1']}
- ROC-AUC: {metrics['roc_auc']}
- Brier score (lower is better-calibrated): {metrics['brier_score']}
- Confusion matrix [[TN, FP], [FN, TP]]: {cm}

## Context for those numbers
- A naive "always predict the majority class" baseline gets {baseline_acc} accuracy
  on this same test set -- the trained model's accuracy ({metrics['accuracy']}) should
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
"""
    with open("model/empty_run_training_report.md", "w") as f:
        f.write(report)

    print(json.dumps(metrics, indent=2))
    print(f"Baseline (majority class) accuracy: {baseline_acc}")
    print(f"Uncalibrated AUC/Brier: {uncalibrated_auc} / {uncalibrated_brier}")
    print("Saved model/empty_run_model.joblib, model/empty_run_feature_schema.json, model/empty_run_training_report.md")


if __name__ == "__main__":
    main()
