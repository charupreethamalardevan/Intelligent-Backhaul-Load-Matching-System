"""
app.py -- IBLMS ML microservice. Serves all FOUR of the project's trained
models over one Flask process:

  - ML Module 1 (Match/Compatibility Prediction) -- trained by train_model.py.
  - ML Module 2 (Profitability Prediction) -- trained by
    train_profitability_model.py, added in Addendum 36.
  - ML Module 3 (Demand Forecasting) -- trained by train_demand_model.py.
  - ML Module 4 (Empty-Run Risk Prediction) -- trained by
    train_empty_run_model.py.

All four run in this same process rather than four separate ones, so running
this project still means exactly one extra long-running process (alongside
the two `npm run dev`s), not four.

All four are OPTIONAL, best-effort signals on top of -- never a replacement
for -- the existing rule-based/deterministic logic (backend/services/
matching.js, backend/services/profitability.js; Modules 3 & 4 introduce
signals IBLMS never computed before at all) -- see backend/services/
mlClient.js, which times out quickly and simply omits the ML field for
whichever endpoint is slow, unreachable, or not running.

Run:
    pip install -r requirements.txt
    python generate_dataset.py                # Module 1 data (once, or to regenerate)
    python train_model.py                      # Module 1 model (once, or to retrain)
    python generate_profitability_dataset.py   # Module 2 data (once, or to regenerate)
    python train_profitability_model.py        # Module 2 model (once, or to retrain)
    python generate_demand_dataset.py          # Module 3 data (once, or to regenerate)
    python train_demand_model.py                # Module 3 model (once, or to retrain)
    python generate_empty_run_dataset.py       # Module 4 data (once, or to regenerate)
    python train_empty_run_model.py              # Module 4 model (once, or to retrain)
    python app.py                               # starts the server on port 5001

Endpoints:
    GET  /health
    POST /predict                        { vehicle, trip, load, ownerRatingAvg? }
    POST /predict-batch                  { items: [ { id, vehicle, trip, load, ownerRatingAvg? }, ... ] }
    POST /predict-profitability          { vehicle, trip, load }
    POST /predict-profitability-batch    { items: [ { id, vehicle, trip, load }, ... ] }
    POST /predict-demand                 { origin, destination, anchorDate, recentLoadCount14d, recentLoadCount30d }
    POST /predict-empty-run-risk         { vehicle, tripSource, tripDestination, availableFrom, compatibleLoadsNearbyCount }
    POST /predict-empty-run-risk-batch   { items: [ { id, vehicle, tripSource, tripDestination, availableFrom, compatibleLoadsNearbyCount }, ... ] }
"""

import json
import math
import os
from datetime import datetime

import joblib
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model", "compatibility_model.joblib")
MODEL_VERSION = "synthetic-v2"
PROFITABILITY_MODEL_PATH = os.path.join(os.path.dirname(__file__), "model", "profitability_model.joblib")
PROFITABILITY_MODEL_VERSION = "synthetic-v1"
DEMAND_MODEL_PATH = os.path.join(os.path.dirname(__file__), "model", "demand_model.joblib")
DEMAND_THRESHOLDS_PATH = os.path.join(os.path.dirname(__file__), "model", "demand_category_thresholds.json")
DEMAND_MODEL_VERSION = "synthetic-v1"
EMPTY_RUN_MODEL_PATH = os.path.join(os.path.dirname(__file__), "model", "empty_run_model.joblib")
EMPTY_RUN_MODEL_VERSION = "synthetic-v1"

app = Flask(__name__)
CORS(app)

try:
    _pipeline = joblib.load(MODEL_PATH)
except Exception as exc:  # noqa: BLE001 -- intentionally broad: a missing,
    # corrupted, or scikit-learn-version-incompatible model file must degrade
    # this one endpoint gracefully, never crash the whole process (the same
    # "best-effort, never blocking" contract backend/services/mlClient.js
    # already relies on for every ML endpoint).
    _pipeline = None
    print(f"[ml-service] WARNING: could not load model at {MODEL_PATH} ({exc!r}). "
          f"Run `python train_model.py` first. /predict will return 503 until then.")

try:
    _profitability_pipeline = joblib.load(PROFITABILITY_MODEL_PATH)
except Exception as exc:  # noqa: BLE001 -- see note above
    _profitability_pipeline = None
    print(f"[ml-service] WARNING: could not load model at {PROFITABILITY_MODEL_PATH} ({exc!r}). "
          f"Run `python train_profitability_model.py` first. /predict-profitability will return 503 until then.")

try:
    _demand_pipeline = joblib.load(DEMAND_MODEL_PATH)
    with open(DEMAND_THRESHOLDS_PATH) as f:
        _demand_thresholds = json.load(f)
except Exception as exc:  # noqa: BLE001 -- see note above
    _demand_pipeline = None
    _demand_thresholds = None
    print(f"[ml-service] WARNING: could not load model at {DEMAND_MODEL_PATH} ({exc!r}). "
          f"Run `python train_demand_model.py` first. /predict-demand will return 503 until then.")

try:
    _empty_run_pipeline = joblib.load(EMPTY_RUN_MODEL_PATH)
except Exception as exc:  # noqa: BLE001 -- see note above
    _empty_run_pipeline = None
    print(f"[ml-service] WARNING: could not load model at {EMPTY_RUN_MODEL_PATH} ({exc!r}). "
          f"Run `python train_empty_run_model.py` first. /predict-empty-run-risk will return 503 until then.")

# ---- Mirrors backend/utils/distance.js CITY_COORDS exactly ----
CITY_COORDS = {
    "chennai": (13.0827, 80.2707),
    "madurai": (9.9252, 78.1198),
    "coimbatore": (11.0168, 76.9558),
    "bengaluru": (12.9716, 77.5946),
    "trichy": (10.7905, 78.7047),
    "salem": (11.6643, 78.146),
    "hyderabad": (17.385, 78.4867),
    "mumbai": (19.076, 72.8777),
    "delhi": (28.7041, 77.1025),
    "kolkata": (22.5726, 88.3639),
    "vijayawada": (16.5062, 80.648),
    "kochi": (9.9312, 76.2673),
    "pune": (18.5204, 73.8567),
    "vellore": (12.9165, 79.1325),
    "tirupati": (13.6288, 79.4192),
    "tirunelveli": (8.7139, 77.7567),
}

FUEL_RATE_PER_KM = 8.0
TOLL_RATE_PER_KM = 1.5
OTHER_RATE_PER_KM = 0.5


def haversine_km(a, b):
    R = 6371.0
    lat1, lon1 = a
    lat2, lon2 = b
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    s = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(s), math.sqrt(1 - s))


def city_km(a, b):
    a = CITY_COORDS.get(str(a or "").strip().lower())
    b = CITY_COORDS.get(str(b or "").strip().lower())
    if not a or not b:
        return None
    return haversine_km(a, b)


def clamp(n, lo=0.0, hi=100.0):
    return max(lo, min(hi, n))


def cyclical(value, period):
    angle = 2.0 * math.pi * (value / period)
    return math.sin(angle), math.cos(angle)


def parse_dt(value):
    # Accepts ISO-8601 strings (what the Node backend / Mongo send over
    # JSON), with or without a trailing "Z".
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def build_features(vehicle, trip, load, owner_rating_avg=None):
    """Returns (feature_row_dict, reason_if_ineligible). Mirrors
    backend/services/matching.js's checkHardConstraints + per-factor scoring
    exactly, so the model only ever ranks pairs the real backend would also
    consider viable."""
    try:
        capacity = float(vehicle["maxCapacityTonnes"])
        vtype = str(vehicle["vehicleType"])
        cargo_compat = set(vehicle.get("cargoCompatibility") or [])

        weight = float(load["cargoWeightTonnes"])
        required_type = str(load.get("requiredVehicleType") or "any")
        cargo_type = str(load["cargoType"])
        expected_price = float(load["expectedPrice"])
        available_from = parse_dt(trip["availableFrom"])
        pickup_dt = parse_dt(load["pickupDateTime"])
        deadline_dt = parse_dt(load["deliveryDeadline"])
    except (KeyError, TypeError, ValueError) as exc:
        return None, f"Missing or invalid field for ML scoring: {exc}"

    if weight > capacity:
        return None, "Cargo exceeds this vehicle's capacity."
    if required_type != "any" and required_type != vtype:
        return None, "Vehicle type does not match the load's requirement."
    if available_from > deadline_dt:
        return None, "The vehicle is not available until after this load's delivery deadline."

    to_pickup_km = city_km(trip["source"], load["pickupLocation"])
    loaded_km = city_km(load["pickupLocation"], load["deliveryLocation"])
    from_delivery_km = city_km(load["deliveryLocation"], trip["destination"])
    direct_km = city_km(trip["source"], trip["destination"])
    if None in (to_pickup_km, loaded_km, from_delivery_km, direct_km):
        return None, "One of the locations is not in the known-city list."

    total_km = to_pickup_km + loaded_km + from_delivery_km
    detour_km = max(0.0, total_km - direct_km)
    route_compatibility = clamp(100.0 - (detour_km / max(direct_km, 1.0)) * 100.0)
    detour_efficiency = clamp(100.0 - detour_km / 2.0)
    capacity_utilization = clamp((weight / capacity) * 100.0)

    slack_hours = (deadline_dt - available_from).total_seconds() / 3600.0
    lead_hours = (pickup_dt - available_from).total_seconds() / 3600.0
    timing_compatibility = 40.0 if lead_hours < 0 else clamp((slack_hours / 72.0) * 100.0, 20.0, 100.0)

    if required_type != "any" and required_type == vtype:
        cargo_vehicle_fit = 100.0 if cargo_type in cargo_compat else 85.0
    elif cargo_type in cargo_compat:
        cargo_vehicle_fit = 80.0
    else:
        cargo_vehicle_fit = 60.0

    fuel_cost = total_km * FUEL_RATE_PER_KM
    toll_cost = total_km * TOLL_RATE_PER_KM
    other_cost = total_km * OTHER_RATE_PER_KM
    operating_cost = fuel_cost + toll_cost + other_cost
    margin = (expected_price - operating_cost) / expected_price if expected_price > 0 else -1.0
    profitability_score = clamp(50.0 + margin * 125.0)

    has_rating = owner_rating_avg is not None
    reliability_input = float(owner_rating_avg) if has_rating else 3.5
    reliability_score = 70.0 if not has_rating else clamp((reliability_input / 5.0) * 100.0)

    price_per_tonne_km = expected_price / max(weight * max(loaded_km, 1), 1)

    vehicle_type_matches_required = str(required_type == "any" or required_type == vtype)

    row = {
        "max_capacity_tonnes": capacity,
        "cargo_weight_tonnes": weight,
        "expected_price": expected_price,
        "to_pickup_km": to_pickup_km,
        "loaded_km": loaded_km,
        "from_delivery_km": from_delivery_km,
        "direct_km": direct_km,
        "total_km": total_km,
        "detour_km": detour_km,
        "detour_ratio": detour_km / max(direct_km, 1.0),
        "capacity_utilization": capacity_utilization,
        "slack_hours": slack_hours,
        "lead_hours": lead_hours,
        "price_per_tonne_km": price_per_tonne_km,
        "route_compatibility": route_compatibility,
        "timing_compatibility": timing_compatibility,
        "cargo_vehicle_fit": cargo_vehicle_fit,
        "detour_efficiency": detour_efficiency,
        "profitability_score": profitability_score,
        "reliability_score": reliability_score,
        "has_rating": int(has_rating),
        "owner_rating_avg": reliability_input,
        "vehicle_type": vtype,
        "required_vehicle_type": required_type,
        "cargo_type": cargo_type,
        "vehicle_type_matches_required": vehicle_type_matches_required,
    }
    return row, None


def predict_one(vehicle, trip, load, owner_rating_avg=None):
    row, reason = build_features(vehicle, trip, load, owner_rating_avg)
    if row is None:
        return {"eligible": False, "reason": reason}
    if _pipeline is None:
        return {"eligible": False, "reason": "Model not loaded on the server."}
    df = pd.DataFrame([row])
    probability = float(_pipeline.predict_proba(df)[0, 1])
    return {"eligible": True, "probability": round(probability, 4), "modelVersion": MODEL_VERSION}


def build_profitability_features(vehicle, trip, load):
    """Returns (feature_row_dict, rule_estimate_dict, reason_if_ineligible)
    for ML Module 2 (Profitability Prediction, Addendum 36). Reproduces the
    same distance/timing calculations build_features() above already does
    (kept as a separate, slightly duplicated function rather than a shared
    refactor of the already-shipped, already-tested Module 1 code, to avoid
    any risk of regressing it) plus backend/services/profitability.js's
    exact cost/revenue/margin formula, and derives month/weekend from the
    load's own pickup time -- every feature here is something the real Node
    backend already has on hand for a vehicle/trip/load triple, no hidden
    synthetic-only factor is required at serving time."""
    try:
        capacity = float(vehicle["maxCapacityTonnes"])
        vtype = str(vehicle["vehicleType"])

        weight = float(load["cargoWeightTonnes"])
        required_type = str(load.get("requiredVehicleType") or "any")
        cargo_type = str(load["cargoType"])
        expected_price = float(load["expectedPrice"])
        available_from = parse_dt(trip["availableFrom"])
        pickup_dt = parse_dt(load["pickupDateTime"])
        deadline_dt = parse_dt(load["deliveryDeadline"])
    except (KeyError, TypeError, ValueError) as exc:
        return None, None, f"Missing or invalid field for ML scoring: {exc}"

    if weight > capacity:
        return None, None, "Cargo exceeds this vehicle's capacity."
    if required_type != "any" and required_type != vtype:
        return None, None, "Vehicle type does not match the load's requirement."
    if available_from > deadline_dt:
        return None, None, "The vehicle is not available until after this load's delivery deadline."

    to_pickup_km = city_km(trip["source"], load["pickupLocation"])
    loaded_km = city_km(load["pickupLocation"], load["deliveryLocation"])
    from_delivery_km = city_km(load["deliveryLocation"], trip["destination"])
    direct_km = city_km(trip["source"], trip["destination"])
    if None in (to_pickup_km, loaded_km, from_delivery_km, direct_km):
        return None, None, "One of the locations is not in the known-city list."

    total_km = to_pickup_km + loaded_km + from_delivery_km
    detour_km = max(0.0, total_km - direct_km)
    capacity_utilization = clamp((weight / capacity) * 100.0)
    slack_hours = (deadline_dt - available_from).total_seconds() / 3600.0
    lead_hours = (pickup_dt - available_from).total_seconds() / 3600.0
    price_per_tonne_km = expected_price / max(weight * max(loaded_km, 1), 1)

    rule_fuel_cost = total_km * FUEL_RATE_PER_KM
    rule_toll_cost = total_km * TOLL_RATE_PER_KM
    rule_other_cost = total_km * OTHER_RATE_PER_KM
    rule_operating_cost = rule_fuel_cost + rule_toll_cost + rule_other_cost
    rule_profit = expected_price - rule_operating_cost
    # Same [-100, 80] clamp used when generating the training data -- keeps
    # a tiny price / huge-detour edge case from producing an absurd ratio.
    rule_margin_pct = clamp(
        (rule_profit / expected_price) * 100.0 if expected_price > 0 else -100.0,
        -100.0, 80.0,
    )

    row = {
        "max_capacity_tonnes": capacity,
        "cargo_weight_tonnes": weight,
        "expected_price": expected_price,
        "to_pickup_km": to_pickup_km,
        "loaded_km": loaded_km,
        "from_delivery_km": from_delivery_km,
        "direct_km": direct_km,
        "total_km": total_km,
        "detour_km": detour_km,
        "detour_ratio": detour_km / max(direct_km, 1.0),
        "capacity_utilization": capacity_utilization,
        "slack_hours": slack_hours,
        "lead_hours": lead_hours,
        "price_per_tonne_km": price_per_tonne_km,
        "rule_fuel_cost": rule_fuel_cost,
        "rule_toll_cost": rule_toll_cost,
        "rule_other_cost": rule_other_cost,
        "rule_operating_cost": rule_operating_cost,
        "rule_profit": rule_profit,
        "rule_margin_pct": rule_margin_pct,
        "vehicle_type": vtype,
        "required_vehicle_type": required_type,
        "cargo_type": cargo_type,
        "month": str(pickup_dt.month),
        "is_weekend": str(pickup_dt.weekday() >= 5),
    }
    rule_estimate = {
        "revenue": round(expected_price, 2),
        "estimatedOperatingCost": round(rule_operating_cost, 2),
        "estimatedProfit": round(rule_profit, 2),
        "estimatedMarginPct": round(rule_margin_pct, 2),
    }
    return row, rule_estimate, None


def predict_profitability_one(vehicle, trip, load):
    row, rule_estimate, reason = build_profitability_features(vehicle, trip, load)
    if row is None:
        return {"eligible": False, "reason": reason}
    if _profitability_pipeline is None:
        return {"eligible": False, "reason": "Profitability model not loaded on the server."}
    df = pd.DataFrame([row])
    predicted_margin_pct = float(_profitability_pipeline.predict(df)[0])
    predicted_profit = round(row["expected_price"] * predicted_margin_pct / 100.0, 2)
    return {
        "eligible": True,
        "ruleEstimate": rule_estimate,
        "predictedMarginPct": round(predicted_margin_pct, 2),
        "predictedProfit": predicted_profit,
        "modelVersion": PROFITABILITY_MODEL_VERSION,
    }


def build_demand_features(origin, destination, anchor_date, recent_load_count_14d, recent_load_count_30d):
    """Returns (feature_row_dict, reason_if_ineligible) for ML Module 3
    (Demand Forecasting, Addendum 39). origin/destination must be known
    cities (same CITY_COORDS list every other module uses); anchor_date is
    the date the forecast is being made FROM (today, in practice) --
    distance and the cyclical day-of-week/day-of-year features are derived
    from it exactly the way generate_demand_dataset.py's label generator
    derives them. recent_load_count_14d/30d are NOT synthetic here -- the
    Node backend (backend/routes/insights.js) computes them live from real
    Load documents on this exact route before calling this endpoint."""
    try:
        origin = str(origin or "").strip().lower()
        destination = str(destination or "").strip().lower()
        anchor = parse_dt(anchor_date)
        recent_14d = float(recent_load_count_14d)
        recent_30d = float(recent_load_count_30d)
    except (TypeError, ValueError) as exc:
        return None, f"Missing or invalid field for ML scoring: {exc}"

    if origin not in CITY_COORDS or destination not in CITY_COORDS:
        return None, "Origin/destination must be one of IBLMS's known cities."

    distance_km = haversine_km(CITY_COORDS[origin], CITY_COORDS[destination])
    dow = anchor.weekday()
    doy = anchor.timetuple().tm_yday
    is_weekend = dow >= 5
    dow_sin, dow_cos = cyclical(dow, 7)
    doy_sin, doy_cos = cyclical(doy, 365)

    row = {
        "origin": origin,
        "destination": destination,
        "distance_km": distance_km,
        "dow_sin": dow_sin,
        "dow_cos": dow_cos,
        "doy_sin": doy_sin,
        "doy_cos": doy_cos,
        "is_weekend": str(is_weekend),
        "recent_load_count_14d": recent_14d,
        "recent_load_count_30d": recent_30d,
    }
    return row, None


def demand_category(predicted_load_count_7d):
    if _demand_thresholds is None:
        return None
    if predicted_load_count_7d <= _demand_thresholds["lowMax"]:
        return "Low"
    if predicted_load_count_7d <= _demand_thresholds["mediumMax"]:
        return "Medium"
    return "High"


def predict_demand_one(origin, destination, anchor_date, recent_load_count_14d, recent_load_count_30d):
    row, reason = build_demand_features(origin, destination, anchor_date, recent_load_count_14d, recent_load_count_30d)
    if row is None:
        return {"eligible": False, "reason": reason}
    if _demand_pipeline is None:
        return {"eligible": False, "reason": "Demand model not loaded on the server."}
    df = pd.DataFrame([row])
    predicted = max(0.0, float(_demand_pipeline.predict(df)[0]))
    return {
        "eligible": True,
        "predictedLoadCount7d": round(predicted, 1),
        "demandCategory": demand_category(predicted),
        "modelVersion": DEMAND_MODEL_VERSION,
    }


def build_empty_run_features(vehicle, trip_source, trip_destination, available_from, compatible_loads_nearby_count):
    """Returns (feature_row_dict, reason_if_ineligible) for ML Module 4
    (Empty-Run Risk Prediction, Addendum 39). compatible_loads_nearby_count
    is NOT synthetic here -- the Node backend (backend/routes/insights.js)
    computes it live for this exact trip's destination, using the same
    radius-based "nearby loads" query as the existing GET /api/loads/near,
    before calling this endpoint."""
    try:
        vtype = str(vehicle["vehicleType"])
        capacity = float(vehicle["maxCapacityTonnes"])
        trip_source = str(trip_source or "").strip().lower()
        trip_destination = str(trip_destination or "").strip().lower()
        available = parse_dt(available_from)
        nearby_count = float(compatible_loads_nearby_count)
    except (KeyError, TypeError, ValueError) as exc:
        return None, f"Missing or invalid field for ML scoring: {exc}"

    if trip_source not in CITY_COORDS or trip_destination not in CITY_COORDS:
        return None, "Trip source/destination must be one of IBLMS's known cities."

    distance_km = haversine_km(CITY_COORDS[trip_source], CITY_COORDS[trip_destination])
    dow = available.weekday()
    doy = available.timetuple().tm_yday
    is_weekend = dow >= 5
    dow_sin, dow_cos = cyclical(dow, 7)
    doy_sin, doy_cos = cyclical(doy, 365)

    row = {
        "vehicle_type": vtype,
        "max_capacity_tonnes": capacity,
        "trip_source": trip_source,
        "trip_destination": trip_destination,
        "distance_km": distance_km,
        "dow_sin": dow_sin,
        "dow_cos": dow_cos,
        "doy_sin": doy_sin,
        "doy_cos": doy_cos,
        "is_weekend": str(is_weekend),
        "compatible_loads_nearby_count": nearby_count,
    }
    return row, None


def empty_run_risk_level(risk_pct):
    # Fixed thresholds, unlike Module 3's dataset-derived tertiles -- this
    # probability is already a calibrated 0-100% risk, not a raw regression
    # output needing a data-driven split.
    if risk_pct < 33.0:
        return "Low"
    if risk_pct < 66.0:
        return "Medium"
    return "High"


def predict_empty_run_one(vehicle, trip_source, trip_destination, available_from, compatible_loads_nearby_count):
    row, reason = build_empty_run_features(vehicle, trip_source, trip_destination, available_from, compatible_loads_nearby_count)
    if row is None:
        return {"eligible": False, "reason": reason}
    if _empty_run_pipeline is None:
        return {"eligible": False, "reason": "Empty-run risk model not loaded on the server."}
    df = pd.DataFrame([row])
    probability = float(_empty_run_pipeline.predict_proba(df)[0, 1])
    risk_pct = round(probability * 100.0, 1)
    return {
        "eligible": True,
        "emptyRunRiskPct": risk_pct,
        "riskLevel": empty_run_risk_level(risk_pct),
        "modelVersion": EMPTY_RUN_MODEL_VERSION,
    }


@app.get("/health")
def health():
    return jsonify({
        "status": "ok" if _pipeline is not None else "model_missing",
        "modelVersion": MODEL_VERSION,
        "profitabilityStatus": "ok" if _profitability_pipeline is not None else "model_missing",
        "profitabilityModelVersion": PROFITABILITY_MODEL_VERSION,
        "demandStatus": "ok" if _demand_pipeline is not None else "model_missing",
        "demandModelVersion": DEMAND_MODEL_VERSION,
        "emptyRunStatus": "ok" if _empty_run_pipeline is not None else "model_missing",
        "emptyRunModelVersion": EMPTY_RUN_MODEL_VERSION,
    })


@app.post("/predict")
def predict():
    body = request.get_json(silent=True) or {}
    result = predict_one(body.get("vehicle") or {}, body.get("trip") or {}, body.get("load") or {}, body.get("ownerRatingAvg"))
    return jsonify(result)


@app.post("/predict-batch")
def predict_batch():
    body = request.get_json(silent=True) or {}
    items = body.get("items") or []
    predictions = []
    for item in items:
        result = predict_one(item.get("vehicle") or {}, item.get("trip") or {}, item.get("load") or {}, item.get("ownerRatingAvg"))
        result["id"] = item.get("id")
        predictions.append(result)
    return jsonify({"predictions": predictions})


@app.post("/predict-profitability")
def predict_profitability():
    body = request.get_json(silent=True) or {}
    result = predict_profitability_one(body.get("vehicle") or {}, body.get("trip") or {}, body.get("load") or {})
    return jsonify(result)


@app.post("/predict-profitability-batch")
def predict_profitability_batch():
    body = request.get_json(silent=True) or {}
    items = body.get("items") or []
    predictions = []
    for item in items:
        result = predict_profitability_one(item.get("vehicle") or {}, item.get("trip") or {}, item.get("load") or {})
        result["id"] = item.get("id")
        predictions.append(result)
    return jsonify({"predictions": predictions})


@app.post("/predict-demand")
def predict_demand():
    body = request.get_json(silent=True) or {}
    result = predict_demand_one(
        body.get("origin"), body.get("destination"), body.get("anchorDate"),
        body.get("recentLoadCount14d", 0), body.get("recentLoadCount30d", 0),
    )
    return jsonify(result)


@app.post("/predict-empty-run-risk")
def predict_empty_run_risk():
    body = request.get_json(silent=True) or {}
    result = predict_empty_run_one(
        body.get("vehicle") or {}, body.get("tripSource"), body.get("tripDestination"),
        body.get("availableFrom"), body.get("compatibleLoadsNearbyCount", 0),
    )
    return jsonify(result)


@app.post("/predict-empty-run-risk-batch")
def predict_empty_run_risk_batch():
    body = request.get_json(silent=True) or {}
    items = body.get("items") or []
    predictions = []
    for item in items:
        result = predict_empty_run_one(
            item.get("vehicle") or {}, item.get("tripSource"), item.get("tripDestination"),
            item.get("availableFrom"), item.get("compatibleLoadsNearbyCount", 0),
        )
        result["id"] = item.get("id")
        predictions.append(result)
    return jsonify({"predictions": predictions})


if __name__ == "__main__":
    # Render (and most PaaS hosts) inject PORT and require the app to bind
    # to it; ML_SERVICE_PORT stays as the local-dev fallback (see README.md).
    port = int(os.environ.get("PORT", os.environ.get("ML_SERVICE_PORT", 5001)))
    app.run(host="0.0.0.0", port=port)
