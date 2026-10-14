"""
generate_dataset.py -- builds the synthetic training set for IBLMS ML Module 1
(Match/Compatibility Prediction).

Why synthetic: IBLMS has no real historical accept/reject outcome data yet
(documented in backend/services/matching.js and the project progress log), so
there is nothing to train a classifier on directly. This script manufactures a
large, realistic candidate population instead -- using the project's own city
list, vehicle types and cargo types -- then derives the exact same seven
domain factors the existing rule-based engine (backend/services/matching.js)
already computes, and finally generates a *proxy* ground-truth label from a
deliberately different, nonlinear, noisy function of those same factors.

That last point matters: the label generator intentionally does NOT reuse
matching.js's fixed linear weights (0.25/0.15/0.15/0.15/0.10/0.15/0.05). If it
did, the trained model would just be re-deriving a formula that already
exists, which would add nothing. Instead the label reflects a capacity
"sweet spot" (neither under- nor over-filled is ideal), an interaction
penalty when a big detour is combined with thin profit margins, and random
noise representing real-world unpredictability that no formula captures.
The trained model is therefore learning a genuinely different, complementary
signal -- not a copy of the rule-based score -- which is the honest framing
given to the user.

This is clearly a SYNTHETIC proxy for real outcomes, not measured data. Every
report this project produces about the resulting model says so explicitly
(Development Rule 8: don't claim high accuracy without real evaluation data).
"""

import csv
import math
import random
from datetime import datetime, timedelta

random.seed(42)  # reproducible dataset

N_ROWS = 90000

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
CITIES = list(CITY_COORDS.keys())

# ---- Mirrors backend/models/Vehicle.js VEHICLE_TYPES ----
VEHICLE_TYPES = ["mini_truck", "open_truck", "container_truck", "refrigerated_truck", "tanker", "trailer"]

# Realistic capacity ranges (tonnes) per vehicle type.
CAPACITY_RANGE = {
    "mini_truck": (1, 3),
    "open_truck": (5, 12),
    "container_truck": (10, 20),
    "refrigerated_truck": (5, 15),
    "tanker": (10, 20),
    "trailer": (15, 30),
}

# Cargo vocabulary -- not an enum in the real schema (cargoType is free
# text), but a realistic closed set keeps the synthetic data coherent.
CARGO_TYPES = [
    "general", "fragile", "perishable", "electronics", "furniture",
    "construction_material", "textiles", "liquid_bulk", "machinery", "agricultural_produce",
]
# Which cargo types each vehicle type can plausibly carry at all (used to
# build each synthetic vehicle's cargoCompatibility list).
PLAUSIBLE_CARGO_FOR_VEHICLE = {
    "mini_truck": ["general", "fragile", "electronics", "textiles"],
    "open_truck": ["general", "construction_material", "agricultural_produce", "machinery", "furniture"],
    "container_truck": ["general", "electronics", "furniture", "textiles", "machinery"],
    "refrigerated_truck": ["perishable", "agricultural_produce", "general"],
    "tanker": ["liquid_bulk"],
    "trailer": ["machinery", "construction_material", "general"],
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


def clamp(n, lo=0.0, hi=100.0):
    return max(lo, min(hi, n))


def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-x))


def random_city_pair():
    a, b = random.sample(CITIES, 2)
    return a, b


def build_vehicle():
    vtype = random.choice(VEHICLE_TYPES)
    lo, hi = CAPACITY_RANGE[vtype]
    capacity = round(random.uniform(lo, hi), 1)
    pool = PLAUSIBLE_CARGO_FOR_VEHICLE[vtype]
    k = random.randint(1, len(pool))
    cargo_compat = random.sample(pool, k)
    return vtype, capacity, cargo_compat


def build_load(all_vehicle_types):
    cargo_type = random.choice(CARGO_TYPES)
    # 55% of loads are open to any vehicle type; the rest require a specific
    # type that plausibly carries this cargo (sometimes still a poor fit, to
    # exercise the hard-constraint rejection path).
    if random.random() < 0.55:
        required_type = "any"
    else:
        candidates = [vt for vt, cargoes in PLAUSIBLE_CARGO_FOR_VEHICLE.items() if cargo_type in cargoes]
        required_type = random.choice(candidates) if candidates and random.random() < 0.8 else random.choice(all_vehicle_types)
    weight = round(random.uniform(0.3, 28), 1)
    return cargo_type, required_type, weight


def score_timing(available_from, pickup_dt, deadline_dt):
    slack_hours = (deadline_dt - available_from).total_seconds() / 3600.0
    lead_hours = (pickup_dt - available_from).total_seconds() / 3600.0
    if lead_hours < 0:
        return 40.0, slack_hours, lead_hours
    return clamp((slack_hours / 72.0) * 100.0, 20.0, 100.0), slack_hours, lead_hours


def score_cargo_fit(vehicle_type, required_type, cargo_compat, cargo_type):
    if required_type != "any" and required_type == vehicle_type:
        return 100.0 if cargo_type in cargo_compat else 85.0
    if cargo_type in cargo_compat:
        return 80.0
    return 60.0


def generate_row(row_id):
    vtype, capacity, cargo_compat = build_vehicle()
    cargo_type, required_type, weight = build_load(VEHICLE_TYPES)

    trip_source, trip_dest = random_city_pair()
    pickup_loc, delivery_loc = random_city_pair()

    now = datetime(2026, 1, 1)
    available_from = now + timedelta(hours=random.uniform(0, 240))
    # lead can be negative (vehicle frees up after pickup time -- tight/bad)
    pickup_dt = available_from + timedelta(hours=random.uniform(-24, 120))
    # transit buffer scaled loosely to loaded distance so deadlines are
    # sometimes generous, sometimes razor-thin or already impossible.
    loaded_km_est = haversine_km(CITY_COORDS[pickup_loc], CITY_COORDS[delivery_loc])
    buffer_hours = random.uniform(-10, 96) + loaded_km_est / 35.0
    deadline_dt = pickup_dt + timedelta(hours=buffer_hours)

    owner_rating = None if random.random() < 0.2 else round(random.uniform(2.5, 5.0), 2)

    # ---- hard constraints (mirror matching.js checkHardConstraints) ----
    if weight > capacity:
        return None
    if required_type != "any" and required_type != vtype:
        return None
    if available_from > deadline_dt:
        return None

    to_pickup_km = haversine_km(CITY_COORDS[trip_source], CITY_COORDS[pickup_loc])
    loaded_km = haversine_km(CITY_COORDS[pickup_loc], CITY_COORDS[delivery_loc])
    from_delivery_km = haversine_km(CITY_COORDS[delivery_loc], CITY_COORDS[trip_dest])
    direct_km = haversine_km(CITY_COORDS[trip_source], CITY_COORDS[trip_dest])
    total_km = to_pickup_km + loaded_km + from_delivery_km
    detour_km = max(0.0, total_km - direct_km)

    route_compatibility = clamp(100.0 - (detour_km / max(direct_km, 1.0)) * 100.0)
    detour_efficiency = clamp(100.0 - detour_km / 2.0)
    capacity_utilization = clamp((weight / capacity) * 100.0)
    timing_compatibility, slack_hours, lead_hours = score_timing(available_from, pickup_dt, deadline_dt)
    cargo_vehicle_fit = score_cargo_fit(vtype, required_type, cargo_compat, cargo_type)

    # price: a shipper's budget, roughly rate-per-tonne-km with real-world
    # noise (shippers under/over-price loads relative to "fair" cost).
    rate_per_tonne_km = random.uniform(8, 22)
    noise_mult = random.uniform(0.75, 1.35)
    expected_price = round(rate_per_tonne_km * weight * max(loaded_km, 5) * noise_mult)

    fuel_cost = total_km * FUEL_RATE_PER_KM
    toll_cost = total_km * TOLL_RATE_PER_KM
    other_cost = total_km * OTHER_RATE_PER_KM
    operating_cost = fuel_cost + toll_cost + other_cost
    margin = (expected_price - operating_cost) / expected_price if expected_price > 0 else -1.0
    profitability_score = clamp(50.0 + margin * 125.0)

    reliability_score = 70.0 if owner_rating is None else clamp((owner_rating / 5.0) * 100.0)

    rule_match_score = round(
        route_compatibility * 0.25
        + capacity_utilization * 0.15
        + timing_compatibility * 0.15
        + cargo_vehicle_fit * 0.15
        + detour_efficiency * 0.10
        + profitability_score * 0.15
        + reliability_score * 0.05
    )

    # ---- proxy ground-truth label: deliberately NOT the formula above ----
    util_frac = capacity_utilization / 100.0
    # bump function peaking near 85% utilization, 0 at the extremes
    util_sweetspot = max(0.0, 1.0 - abs(util_frac - 0.85) / 0.85) * 100.0

    interaction_penalty = 0.0
    if detour_km > 150 and profitability_score < 40:
        interaction_penalty = 1.6  # big detour AND thin margin compounds badly
    if route_compatibility > 85 and profitability_score > 70:
        interaction_penalty -= 0.6  # a clean, profitable match gets a small bonus

    noise = random.gauss(0, 1.0)

    true_logit = (
        2.0 * (route_compatibility / 100.0)
        + 1.3 * (util_sweetspot / 100.0)
        + 1.0 * (timing_compatibility / 100.0)
        + 1.1 * (cargo_vehicle_fit / 100.0)
        + 0.8 * (detour_efficiency / 100.0)
        + 1.4 * (profitability_score / 100.0)
        + 0.5 * (reliability_score / 100.0)
        - interaction_penalty
        + noise
        - 3.4
    )
    true_probability = sigmoid(true_logit)
    label = 1 if random.random() < true_probability else 0

    price_per_tonne_km = expected_price / max(weight * max(loaded_km, 1), 1)

    return {
        "row_id": row_id,
        "vehicle_type": vtype,
        "max_capacity_tonnes": capacity,
        "cargo_compatibility": ";".join(cargo_compat),
        "trip_source": trip_source,
        "trip_destination": trip_dest,
        "pickup_location": pickup_loc,
        "delivery_location": delivery_loc,
        "cargo_type": cargo_type,
        "required_vehicle_type": required_type,
        "cargo_weight_tonnes": weight,
        "expected_price": expected_price,
        "owner_rating_avg": "" if owner_rating is None else owner_rating,
        "to_pickup_km": round(to_pickup_km, 1),
        "loaded_km": round(loaded_km, 1),
        "from_delivery_km": round(from_delivery_km, 1),
        "direct_km": round(direct_km, 1),
        "total_km": round(total_km, 1),
        "detour_km": round(detour_km, 1),
        "detour_ratio": round(detour_km / max(direct_km, 1.0), 4),
        "capacity_utilization": round(capacity_utilization, 2),
        "slack_hours": round(slack_hours, 1),
        "lead_hours": round(lead_hours, 1),
        "price_per_tonne_km": round(price_per_tonne_km, 3),
        "route_compatibility": round(route_compatibility, 2),
        "timing_compatibility": round(timing_compatibility, 2),
        "cargo_vehicle_fit": round(cargo_vehicle_fit, 2),
        "detour_efficiency": round(detour_efficiency, 2),
        "profitability_score": round(profitability_score, 2),
        "reliability_score": round(reliability_score, 2),
        "rule_match_score": rule_match_score,  # reference only -- NOT fed to the model as a feature
        "true_probability": round(true_probability, 4),  # debug/report only -- NOT fed to the model
        "compatibility_label": label,
    }


def main():
    rows = []
    attempts = 0
    while len(rows) < N_ROWS:
        attempts += 1
        row = generate_row(len(rows))
        if row is not None:
            rows.append(row)

    rejected = attempts - len(rows)
    print(f"Generated {len(rows)} viable rows from {attempts} candidates ({rejected} rejected by hard constraints, {rejected/attempts:.1%}).")
    pos = sum(r["compatibility_label"] for r in rows)
    print(f"Label balance: {pos} positive / {len(rows) - pos} negative ({pos/len(rows):.1%} positive).")

    out_path = "data/synthetic_matches.csv"
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
