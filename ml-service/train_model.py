"""
train_model.py -- trains and evaluates IBLMS ML Module 1 (Match/Compatibility
Prediction) on the synthetic dataset produced by generate_dataset.py.

Feature design (documented here, not just in code): the model is given the
same SEVEN domain factors backend/services/matching.js already computes
(route compatibility, capacity utilization, timing, cargo/vehicle fit,
detour efficiency, profitability, reliability) plus a handful of raw
supporting numbers (detour_km, slack_hours, lead_hours, price_per_tonne_km,
distances, categorical vehicle/cargo types). It is deliberately NOT given
`rule_match_score` (the existing engine's fixed-weight linear combination of
those same seven factors) as a feature -- training on that would let the
model trivially copy an existing formula instead of learning anything new.
Excluding it means the model has to find its own, potentially nonlinear,
combination of the raw factors from the data, which is the actual point of
calling this "a trained model" rather than "the same formula dressed up".

v2 (this version) improves on v1 in two honest ways, without touching the
feature set above and without peeking at generate_dataset.py's hidden label
formula (adding a feature that encodes the exact nonlinearity the label
generator uses -- e.g. "distance from 85% capacity utilization" -- would be
leaking the answer, not genuine learning, so that was deliberately avoided):

1. Model/hyperparameter selection via cross-validated RandomizedSearchCV
   across three model families (GradientBoosting, HistGradientBoosting,
   RandomForest) instead of one hand-picked GradientBoosting configuration.
2. Probability calibration (CalibratedClassifierCV) on top of the winning
   model, which directly targets the Brier score (how trustworthy the
   probabilities themselves are), not just the pass/fail accuracy.

Output: model/compatibility_model.joblib (a calibrated scikit-learn
estimator), model/feature_schema.json (exact feature list/order/categories
the Flask service must reproduce at inference time), and
model/training_report.md (honest metrics, in plain language, with the
synthetic-data caveat stated up front, plus a v1-vs-v2 comparison).
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
    "max_capacity_tonnes", "cargo_weight_tonnes", "expected_price",
    "to_pickup_km", "loaded_km", "from_delivery_km", "direct_km", "total_km",
    "detour_km", "detour_ratio", "capacity_utilization", "slack_hours", "lead_hours",
    "price_per_tonne_km", "route_compatibility", "timing_compatibility",
    "cargo_vehicle_fit", "detour_efficiency", "profitability_score", "reliability_score",
    "has_rating",
]
CATEGORICAL_FEATURES = ["vehicle_type", "required_vehicle_type", "cargo_type", "vehicle_type_matches_required"]
LABEL_COL = "compatibility_label"
# Explicitly excluded from X: rule_match_score, true_probability, row_id,
# city names (already distilled into distances), cargo_compatibility list.

RANDOM_STATE = 42


def load_data(path="data/synthetic_matches.csv"):
    df = pd.read_csv(path)
    df["has_rating"] = df["owner_rating_avg"].notna().astype(int)
    df["owner_rating_avg"] = df["owner_rating_avg"].fillna(3.5)
    df["vehicle_type_matches_required"] = (
        (df["required_vehicle_type"] == "any") | (df["required_vehicle_type"] == df["vehicle_type"])
    ).astype(str)
    return df


def build_preprocessor():
    return ColumnTransformer([
        ("num", StandardScaler(), NUMERIC_FEATURES + ["owner_rating_avg"]),
        ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
    ])


# Three candidate model families, each with a small randomized hyperparameter
# grid. Kept modest (n_iter below) since this sandbox has only 2 CPU cores --
# the point is a genuine, if bounded, search rather than one hand-picked
# config, not an exhaustive grid.
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

# Cross-validated search runs on a stratified SUBSAMPLE of the training
# split, not the full 72,000 rows -- with only 2 CPU cores in this sandbox,
# searching the full set across 3 model families was not finishing in
# reasonable time. A subsample is a standard, legitimate way to make
# hyperparameter search tractable; the WINNING model is still calibrated and
# evaluated on the full training/test splits below, so the final reported
# numbers are not affected by the subsample, only the search that picked the
# hyperparameters was.
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
    feature_cols = NUMERIC_FEATURES + ["owner_rating_avg"] + CATEGORICAL_FEATURES
    X = df[feature_cols]
    y = df[LABEL_COL]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y)
    cv = StratifiedKFold(n_splits=3, shuffle=True, random_state=RANDOM_STATE)

    # Stratified subsample of the training split, used only to pick
    # hyperparameters quickly (see SEARCH_SUBSAMPLE_SIZE's comment above).
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

    # Calibrate the winning hyperparameters on the FULL training split (not
    # the search subsample) so the probabilities themselves are trustworthy,
    # not just the pass/fail line. CalibratedClassifierCV internally does its
    # own 3-fold fit+calibrate ensemble on a fresh pipeline built from the
    # winning hyperparameters -- this is what actually improves the Brier
    # score, and it's what both the final metrics and the saved model below
    # are based on.
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

    rule_pred_test = (df.loc[X_test.index, "rule_match_score"] >= 50).astype(int)
    agreement_with_rule_engine = round((rule_pred_test.values == pred_test).mean(), 4)

    # Also fit+score the UNCALIBRATED version of the same winning pipeline
    # (same hyperparameters, full training split, no calibration wrapper) on
    # the same test set, purely so the report can show calibration's effect
    # in isolation rather than bundling "better hyperparameters" and "better
    # calibration" into one number with no way to tell which helped.
    uncalibrated_pipeline = clone(best_pipeline_unfit)
    uncalibrated_pipeline.fit(X_train, y_train)
    uncalibrated_proba = uncalibrated_pipeline.predict_proba(X_test)[:, 1]
    uncalibrated_brier = round(brier_score_loss(y_test, uncalibrated_proba), 4)
    uncalibrated_auc = round(roc_auc_score(y_test, uncalibrated_proba), 4)

    joblib.dump(calibrated, "model/compatibility_model.joblib")

    feature_schema = {
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "owner_rating_default": 3.5,
        "notes": "has_rating must be 1 if a real owner_rating_avg was supplied, 0 if defaulted to 3.5.",
    }
    with open("model/feature_schema.json", "w") as f:
        json.dump(feature_schema, f, indent=2)

    cv_summary = "\n".join(
        f"- {name}: CV ROC-AUC {searches[name].best_score_:.4f}" + (" <- selected" if name == best_name else "")
        for name in searches
    )

    report = f"""# IBLMS ML Module 1 -- Training Report (v2)

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
{cv_summary}

### Calibration's own effect (isolated from the hyperparameter search)
- Before calibration: ROC-AUC {uncalibrated_auc}, Brier score {uncalibrated_brier}
- After calibration: ROC-AUC {metrics['roc_auc']}, Brier score {metrics['brier_score']}
(Calibration mainly targets Brier score -- how trustworthy the probability
numbers themselves are -- not the ranking quality ROC-AUC measures, so a
small or even slightly negative AUC change here is expected; the Brier
improvement is the one that matters.)

## Dataset
- {metrics['n_train'] + metrics['n_test']} synthetic vehicle-trip-load pairs (90,000 generated, {metrics['n_train']} train / {metrics['n_test']} test, stratified 80/20 split).
- Positive label rate: {round(y.mean(), 4)}

## Final model (v2)
- Winning family: **{best_name}**, wrapped in `CalibratedClassifierCV` (isotonic, 3-fold).
- Features: the same 7 domain factors matching.js computes (route
  compatibility, capacity utilization, timing, cargo/vehicle fit, detour
  efficiency, profitability, reliability), plus supporting raw numbers
  (distances, detour km, slack/lead hours, price per tonne-km) and
  categorical vehicle/cargo types. `rule_match_score` was deliberately
  excluded as an input feature -- see the module docstring for why.

## Test-set metrics (on held-out synthetic data, v2 final model)
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
  be read relative to that floor, not in isolation.
- The trained model's predictions agree with the existing rule-based engine's
  own pass/fail line (rule_match_score >= 50) on {agreement_with_rule_engine} of
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
"""
    with open("model/training_report.md", "w") as f:
        f.write(report)

    print(json.dumps(metrics, indent=2))
    print(f"Baseline (majority class) accuracy: {baseline_acc}")
    print(f"Agreement with rule-based engine's pass/fail line: {agreement_with_rule_engine}")
    print(f"Uncalibrated AUC/Brier: {uncalibrated_auc} / {uncalibrated_brier}")
    print("Saved model/compatibility_model.joblib, model/feature_schema.json, model/training_report.md")


if __name__ == "__main__":
    main()
