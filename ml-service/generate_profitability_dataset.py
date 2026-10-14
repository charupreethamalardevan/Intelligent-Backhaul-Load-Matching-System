"""
generate_profitability_dataset.py -- builds the synthetic training set for
IBLMS ML Module 2 (Profitability Prediction).

Design note, read this before touching the label formula below: Module 1
(generate_dataset.py) deliberately EXCLUDED the rule-based engine's own
aggregate score (rule_match_score) as an input feature, because the goal
there was to force the model to re-derive a combination of the seven raw
factors independently, rather than just copying an existing number back out.

Module 2 makes the OPPOSITE, and equally deliberate, choice: it DOES include
the existing rule-based profitability estimate (backend/services/
profitability.js's revenue/cost/margin calculation, reproduced exactly below
as rule_margin_pct and friends) as an input feature. That is not leakage here,
because the label this model predicts -- realized_margin_pct -- is NOT a
disguised copy of rule_margin_pct. It is the rule-based estimate run through
several real-world cost components profitability.js's formula has NO way to
account for, because they are not in its inputs at all:

  - cargo-specific handling/loading overhead (fragile, perishable and
    machinery cargo cost more to load/unload per tonne than general goods --
    profitability.js charges every cargo type the same flat per-km rate)
  - dock/pickup waiting time, which varies by cargo complexity and adds a
    real labour cost profitability.js never models
  - fuel-price and congestion variance around the fixed assumed rates
  - price realization variance (the price a shipper actually pays can drift
    from the quoted `expectedPrice`, correlated with how much lead time the
    booking had)

So the model's job is to learn, from factors that ARE knowable at quote time
(the rule estimate itself, plus distances, utilization, cargo/vehicle type,
season, lead time), how far the realized outcome tends to drift from that
estimate -- i.e. to predict a correction, not to re-derive the formula from
scratch. The four bullet points above are generated with real randomness
(not derivable from the input features alone), which is what keeps this
honest: no amount of model cleverness can close that gap completely, by
design, exactly like Module 1's injected noise imposes its own ceiling.

This is a SYNTHETIC proxy for real outcomes, not measured data -- IBLMS has
no real completed-trip P&L history yet. Every report this project produces
about the resulting model says so explicitly (Development Rule 8).
"""

import csv
import math
import random
from datetime import datetime, timedelta

random.seed(43)  # reproducible dataset (different seed from Module 1's 42,
                  # so the two synthetic datasets are independently sampled)

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

VEHICLE_TYPES = ["mini_truck", "open_truck", "container_truck", "refrigerated_truck", "tanker", "trailer"]
CAPACITY_RANGE = {
    "mini_truck": (1, 3),
    "open_truck": (5, 12),
    "container_truck": (10, 20),
    "refrigerated_truck": (5, 15),
    "tanker": (10, 20),
    "trailer": (15, 30),
}
CARGO_TYPES = [
    "general", "fragile", "perishable", "electronics", "furniture",
    "construction_material", "textiles", "liquid_bulk", "machinery", "agricultural_produce",
]
PLAUSIBLE_CARGO_FOR_VEHICLE = {
    "mini_truck": ["general", "fragile", "electronics", "textiles"],
    "open_truck": ["general", "construction_material", "agricultural_produce", "machinery", "furniture"],
    "container_truck": ["general", "electronics", "furniture", "textiles", "machinery"],
    "refrigerated_truck": ["perishable", "agricultural_produce", "general"],
    "tanker": ["liquid_bulk"],
    "trailer": ["machinery", "construction_material", "general"],
}

# ---- Exactly backend/services/profitability.js's own documented rates ----
FUEL_RATE_PER_KM = 8.0
TOLL_RATE_PER_KM = 1.5
OTHER_RATE_PER_KM = 0.5

# ---- New cost components NOT present in profitability.js at all (this is
# the genuinely new information the trained model has to learn) ----
# Per-tonne handling/loading overhead, ₹/tonne -- varies a lot by cargo type
# in real trucking but profitability.js charges every cargo the same flat
# per-km rate regardless of what's actually being carried.
HANDLING_RATE_PER_TONNE = {
    "general": 20, "fragile": 60, "perishable": 80, "electronics": 70,
    "furniture": 50, "construction_material": 30, "textiles": 25,
    "liquid_bulk": 90, "machinery": 110, "agricultural_produce": 35,
}
# Mean dock/pickup waiting hours by cargo type (complex cargo = more time
# spent loading/unloading/paperwork before the clock on the trip even starts).
WAITING_HOURS_MEAN = {
    "general": 1.0, "fragile": 2.0, "perishable": 1.5, "electronics": 1.8,
    "furniture": 1.5, "construction_material": 2.5, "textiles": 1.2,
    "liquid_bulk": 3.0, "machinery": 3.5, "agricultural_produce": 1.3,
}
DRIVER_WAGE_PER_HOUR = 120.0  # ₹/hour, waiting-time labour cost


def haversine_km(a, b):
    R = 6371.0
    lat1, lon1 = a
    lat2, lon2 = b
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    s = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(s), math.sqrt(1 - s))


def clamp(n, lo, hi):
    return max(lo, min(hi, n))


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
    if random.random() < 0.55:
        required_type = "any"
    else:
        candidates = [vt for vt, cargoes in PLAUSIBLE_CARGO_FOR_VEHICLE.items() if cargo_type in cargoes]
        required_type = random.choice(candidates) if candidates and random.random() < 0.8 else random.choice(all_vehicle_types)
    weight = round(random.uniform(0.3, 28), 1)
    return cargo_type, required_type, weight


def generate_row(row_id):
    vtype, capacity, cargo_compat = build_vehicle()
    cargo_type, required_type, weight = build_load(VEHICLE_TYPES)

    trip_source, trip_dest = random_city_pair()
    pickup_loc, delivery_loc = random_city_pair()

    now = datetime(2026, 1, 1)
    available_from = now + timedelta(hours=random.uniform(0, 240))
    pickup_dt = available_from + timedelta(hours=random.uniform(-24, 120))
    loaded_km_est = haversine_km(CITY_COORDS[pickup_loc], CITY_COORDS[delivery_loc])
    buffer_hours = random.uniform(-10, 96) + loaded_km_est / 35.0
    deadline_dt = pickup_dt + timedelta(hours=buffer_hours)

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
    detour_ratio = detour_km / max(direct_km, 1.0)
    capacity_utilization = clamp((weight / capacity) * 100.0, 0.0, 100.0)
    slack_hours = (deadline_dt - available_from).total_seconds() / 3600.0
    lead_hours = (pickup_dt - available_from).total_seconds() / 3600.0

    rate_per_tonne_km = random.uniform(8, 22)
    noise_mult = random.uniform(0.75, 1.35)
    expected_price = round(rate_per_tonne_km * weight * max(loaded_km, 5) * noise_mult)
    price_per_tonne_km = expected_price / max(weight * max(loaded_km, 1), 1)

    # ---- rule-based estimate, EXACTLY profitability.js's own formula ----
    rule_fuel_cost = total_km * FUEL_RATE_PER_KM
    rule_toll_cost = total_km * TOLL_RATE_PER_KM
    rule_other_cost = total_km * OTHER_RATE_PER_KM
    rule_operating_cost = rule_fuel_cost + rule_toll_cost + rule_other_cost
    rule_profit = expected_price - rule_operating_cost
    # Clamped to the same [-100, 80] band as realized_margin_pct below. A tiny
    # synthetic price paired with a huge reposition distance can otherwise
    # produce an absurd ratio (cost >> revenue near zero) that would dominate
    # every summary statistic and distort the model's feature scaling --
    # clamping keeps this a meaningful "how good a deal is this" number in
    # both columns, consistent with how it's displayed in the real app.
    rule_margin_pct = clamp(
        (rule_profit / expected_price) * 100.0 if expected_price > 0 else -100.0,
        -100.0, 80.0,
    )

    month = pickup_dt.month
    is_weekend = pickup_dt.weekday() >= 5

    # ---- hidden, unobservable-at-quote-time factors (NOT fed to the model
    # as features -- this is what keeps the label from being a trivial copy
    # of rule_margin_pct, and what imposes an honest ceiling on accuracy) ----
    fuel_price_index = clamp(random.gauss(1.0, 0.10), 0.8, 1.3)
    congestion_index = clamp(1.0 + total_km / 4000.0 + random.uniform(-0.08, 0.20), 0.9, 1.4)
    toll_variance = random.uniform(0.95, 1.05)
    waiting_hours = max(0.0, random.gauss(WAITING_HOURS_MEAN[cargo_type], 0.8))
    lead_bias = 0.02 if lead_hours > 48 else (-0.04 if lead_hours < 6 else 0.0)
    price_realization_factor = clamp(1.0 + lead_bias + random.gauss(0, 0.04), 0.8, 1.12)

    handling_overhead = HANDLING_RATE_PER_TONNE[cargo_type] * weight * random.uniform(0.7, 1.4)
    waiting_cost = waiting_hours * DRIVER_WAGE_PER_HOUR

    actual_fuel_cost = total_km * FUEL_RATE_PER_KM * fuel_price_index
    actual_toll_cost = total_km * TOLL_RATE_PER_KM * toll_variance
    actual_other_cost = total_km * OTHER_RATE_PER_KM * congestion_index
    actual_operating_cost = actual_fuel_cost + actual_toll_cost + actual_other_cost + handling_overhead + waiting_cost

    realized_revenue = expected_price * price_realization_factor
    realized_profit = realized_revenue - actual_operating_cost
    realized_margin_pct = clamp(
        (realized_profit / realized_revenue) * 100.0 if realized_revenue > 0 else -100.0,
        -100.0, 80.0,
    )

    return {
        "row_id": row_id,
        "vehicle_type": vtype,
        "max_capacity_tonnes": capacity,
        "trip_source": trip_source,
        "trip_destination": trip_dest,
        "pickup_location": pickup_loc,
        "delivery_location": delivery_loc,
        "cargo_type": cargo_type,
        "required_vehicle_type": required_type,
        "cargo_weight_tonnes": weight,
        "expected_price": expected_price,
        "to_pickup_km": round(to_pickup_km, 1),
        "loaded_km": round(loaded_km, 1),
        "from_delivery_km": round(from_delivery_km, 1),
        "direct_km": round(direct_km, 1),
        "total_km": round(total_km, 1),
        "detour_km": round(detour_km, 1),
        "detour_ratio": round(detour_ratio, 4),
        "capacity_utilization": round(capacity_utilization, 2),
        "slack_hours": round(slack_hours, 1),
        "lead_hours": round(lead_hours, 1),
        "price_per_tonne_km": round(price_per_tonne_km, 3),
        "month": month,
        "is_weekend": str(is_weekend),
        "rule_fuel_cost": round(rule_fuel_cost, 1),
        "rule_toll_cost": round(rule_toll_cost, 1),
        "rule_other_cost": round(rule_other_cost, 1),
        "rule_operating_cost": round(rule_operating_cost, 1),
        "rule_profit": round(rule_profit, 1),
        "rule_margin_pct": round(rule_margin_pct, 2),
        # Debug/report only -- never fed to the model as a feature:
        "fuel_price_index": round(fuel_price_index, 3),
        "congestion_index": round(congestion_index, 3),
        "waiting_hours": round(waiting_hours, 2),
        "handling_overhead": round(handling_overhead, 1),
        "price_realization_factor": round(price_realization_factor, 3),
        "realized_margin_pct": round(realized_margin_pct, 2),
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

    gap = [r["realized_margin_pct"] - r["rule_margin_pct"] for r in rows]
    mean_gap = sum(gap) / len(gap)
    mean_abs_gap = sum(abs(g) for g in gap) / len(gap)
    print(f"Realized vs. rule-estimated margin: mean gap {mean_gap:+.2f} pts, mean absolute gap {mean_abs_gap:.2f} pts.")

    out_path = "data/synthetic_profitability.csv"
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
