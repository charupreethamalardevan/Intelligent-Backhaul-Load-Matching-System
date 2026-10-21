"""
generate_empty_run_dataset.py -- builds the synthetic training set for IBLMS
ML Module 4 (Empty-Run Risk Prediction, SRS section 7: "Predict the
likelihood that a vehicle will return empty, e.g. 'Empty-run risk: 78%.' If
risk is high, IBLMS can proactively recommend available loads or suggest
routes where demand is higher.").

Why synthetic: same reason as every other ML module in this project (see
generate_dataset.py's module docstring) -- IBLMS has no real completed-trip
history yet to learn genuine empty-return outcomes from.

Design, read this before touching the label formula below:

- "Empty run" here means: this vehicle's planned trip ended without a
  backhaul load booked. The single most informative REAL, live-computable
  signal for this is how many compatible open loads currently exist near the
  trip's destination -- backend/routes/insights.js computes this for real
  (same radius-based nearby-loads query pattern as the existing
  GET /api/loads/near, reused here) and passes it to the model as
  `compatible_loads_nearby_count`. Only the TRAINING values for this column
  are synthesized below (correlated with a hidden synthetic per-city
  popularity tier, since no real load-posting history exists yet to sample
  from), exactly like Module 3's recent_load_count_14d/30d.

- The hidden per-city popularity tier (CITY_WEIGHT, same tiers Module 3
  uses) is used ONLY to bias the label and the synthetic
  compatible_loads_nearby_count feature above -- never passed to the model
  directly. The model instead sees trip_source/trip_destination as
  categorical features, so it can still learn a per-city effect from the
  data (same pattern as every other module here).

- Trip distance and day-of-week/seasonality of the vehicle's availableFrom
  date round out the feature set -- a long reposition trip into a small town
  on a weekend is a different risk profile than a short hop into a major
  hub on a weekday, and the label generator reflects that.

This is a SYNTHETIC proxy for real empty-run outcomes, not measured data.
Every report this project produces about the resulting model says so
explicitly (Development Rule 8: don't claim high accuracy without real
evaluation data).
"""

import csv
import math
import random
from datetime import datetime, timedelta

random.seed(45)  # reproducible; distinct from Modules 1 (42), 2 (43), 3 (44).

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

# Same synthetic route-popularity tiers as Module 3 (generate_demand_dataset.py)
# -- kept as a separately-defined copy in this file (not a shared import)
# since each generator script in this project is deliberately self-contained.
CITY_WEIGHT = {
    "chennai": 3, "bengaluru": 3, "mumbai": 3, "delhi": 3, "hyderabad": 3,
    "kolkata": 3, "pune": 3,
    "coimbatore": 2, "vijayawada": 2, "kochi": 2, "madurai": 2,
    "trichy": 1, "salem": 1, "vellore": 1, "tirupati": 1, "tirunelveli": 1,
}

VEHICLE_TYPES = ["mini_truck", "open_truck", "container_truck", "refrigerated_truck", "tanker", "trailer"]
CAPACITY_RANGE = {
    "mini_truck": (1, 3),
    "open_truck": (5, 12),
    "container_truck": (10, 20),
    "refrigerated_truck": (5, 15),
    "tanker": (10, 20),
    "trailer": (15, 30),
}


def haversine_km(a, b):
    R = 6371.0
    lat1, lon1 = a
    lat2, lon2 = b
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    s = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(s), math.sqrt(1 - s))


def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-x))


def random_city_pair():
    a, b = random.sample(CITIES, 2)
    return a, b


def random_available_from():
    base = datetime(2026, 1, 1)
    return base + timedelta(days=random.uniform(0, 365), hours=random.uniform(0, 23))


def cyclical(value, period):
    angle = 2.0 * math.pi * (value / period)
    return math.sin(angle), math.cos(angle)


def build_vehicle():
    vtype = random.choice(VEHICLE_TYPES)
    lo, hi = CAPACITY_RANGE[vtype]
    capacity = round(random.uniform(lo, hi), 1)
    return vtype, capacity


def generate_row(row_id):
    vtype, capacity = build_vehicle()
    trip_source, trip_dest = random_city_pair()
    distance_km = haversine_km(CITY_COORDS[trip_source], CITY_COORDS[trip_dest])

    available_from = random_available_from()
    dow = available_from.weekday()
    doy = available_from.timetuple().tm_yday
    is_weekend = dow >= 5
    dow_sin, dow_cos = cyclical(dow, 7)
    doy_sin, doy_cos = cyclical(doy, 365)

    dest_weight = CITY_WEIGHT[trip_dest]

    # ---- synthetic "compatible loads nearby" (see module docstring: at
    # serving time this comes from a real radius-based query over actual
    # open Load documents, same pattern as the existing GET /api/loads/near) ----
    mean_nearby = 1.3 * dest_weight + 0.5
    compatible_loads_nearby_count = max(0, round(random.gauss(mean_nearby, mean_nearby * 0.5)))

    # ---- label: probability this trip ends with no backhaul booked ----
    weekend_bump = 0.4 if is_weekend else 0.0
    # Smaller vehicles have more compatible loads in general (more cargo
    # types fit a mini/open truck than a tanker), so they carry a small
    # independent risk discount beyond the nearby-count signal alone.
    type_adjust = {"mini_truck": -0.25, "open_truck": -0.15, "container_truck": 0.0,
                   "refrigerated_truck": 0.35, "tanker": 0.45, "trailer": 0.1}[vtype]
    noise = random.gauss(0, 0.6)

    true_logit = (
        1.05
        - 0.38 * compatible_loads_nearby_count
        + 0.0018 * distance_km
        - 0.20 * dest_weight
        + weekend_bump
        + type_adjust
        + noise
    )
    true_probability = sigmoid(true_logit)
    empty_run_label = 1 if random.random() < true_probability else 0

    return {
        "row_id": row_id,
        "vehicle_type": vtype,
        "max_capacity_tonnes": capacity,
        "trip_source": trip_source,
        "trip_destination": trip_dest,
        "distance_km": round(distance_km, 1),
        "available_from": available_from.isoformat(),
        "dow_sin": round(dow_sin, 4),
        "dow_cos": round(dow_cos, 4),
        "doy_sin": round(doy_sin, 4),
        "doy_cos": round(doy_cos, 4),
        "is_weekend": str(is_weekend),
        "compatible_loads_nearby_count": compatible_loads_nearby_count,
        # Debug/report only -- NOT fed to the model as a feature:
        "dest_weight": dest_weight,
        "true_probability": round(true_probability, 4),
        "empty_run_label": empty_run_label,
    }


def main():
    rows = [generate_row(i) for i in range(N_ROWS)]

    pos = sum(r["empty_run_label"] for r in rows)
    print(f"Generated {len(rows)} synthetic vehicle-trip samples.")
    print(f"Label balance: {pos} empty-run / {len(rows) - pos} backhaul-found ({pos/len(rows):.1%} empty-run rate).")

    out_path = "data/synthetic_empty_run.csv"
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
