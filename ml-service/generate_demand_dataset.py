"""
generate_demand_dataset.py -- builds the synthetic training set for IBLMS ML
Module 3 (Demand Forecasting, SRS section 7: "Predict future demand for
transportation on particular routes, e.g. 'Route: Madurai -> Chennai,
Predicted demand next 7 days: High.' Helps fleet owners decide where to
position their vehicles.").

Why synthetic: exactly the same reason as Modules 1 and 2 (generate_dataset.py,
generate_profitability_dataset.py) -- IBLMS has no real multi-month load-
posting history yet to learn a genuine demand curve from. This script
manufactures a large, plausible population of (route, forecast-date) samples
instead, using the project's own 16-city list, and derives a label from a
deliberately documented, non-trivial function of observable route/seasonal/
momentum signals plus noise.

Design, read this before touching the label formula below:

- Each city gets a fixed, synthetic "route-weight" tier (CITY_WEIGHT below) --
  a deliberately simplified stand-in for a real traffic/economic-activity
  dataset, which this project does not have access to. It is used ONLY to
  bias (a) the label and (b) the synthetic "recent activity" features below
  -- it is never itself passed to the model as a feature. The model instead
  sees the route's actual origin/destination city names as categorical
  features (so it CAN learn a per-city effect from the data, the same way
  Module 1 learns from vehicle_type/cargo_type) plus the two "recent load
  count" numbers, which correlate with but do not equal the hidden weight.

- "Recent load count" (14-day and 30-day windows) is the one feature in this
  module that is NOT purely synthetic at serving time: the real Node backend
  computes it live from actual Load documents on that exact route
  (backend/routes/insights.js), the same way Modules 1/2 pass real vehicle/
  trip/load fields to their models. Only the TRAINING values for this column
  are synthesized here (correlated with CITY_WEIGHT plus noise, since no real
  multi-month history exists yet to sample from), consistent with how every
  other ML module in this project synthesizes training data for live,
  real-feature inputs.

- A deliberately simple seasonal bump (peaking in a fixed documented month)
  and a weekend/weekday effect round out the label, giving the model
  something to find beyond a flat per-route constant.

This is a SYNTHETIC proxy for real demand, not measured data. Every report
this project produces about the resulting model says so explicitly
(Development Rule 8: don't claim high accuracy without real evaluation data).
"""

import csv
import math
import random
from datetime import datetime, timedelta

random.seed(44)  # reproducible dataset; distinct from Module 1's 42 and
                  # Module 2's 43 so all three synthetic datasets are
                  # independently sampled.

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

# Synthetic route-popularity tier per city -- see module docstring. 3 = major
# metro/logistics hub, 2 = mid-size city, 1 = smaller district town. This is
# a deliberately simplified proxy, not a real traffic dataset.
CITY_WEIGHT = {
    "chennai": 3, "bengaluru": 3, "mumbai": 3, "delhi": 3, "hyderabad": 3,
    "kolkata": 3, "pune": 3,
    "coimbatore": 2, "vijayawada": 2, "kochi": 2, "madurai": 2,
    "trichy": 1, "salem": 1, "vellore": 1, "tirupati": 1, "tirunelveli": 1,
}


def haversine_km(a, b):
    R = 6371.0
    lat1, lon1 = a
    lat2, lon2 = b
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    s = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(s), math.sqrt(1 - s))


def random_city_pair():
    a, b = random.sample(CITIES, 2)
    return a, b


def random_anchor_date():
    # Spread anchor dates across a full year so the seasonal term below gets
    # real coverage, not just a handful of calendar days.
    base = datetime(2026, 1, 1)
    return base + timedelta(days=random.uniform(0, 365))


def cyclical(value, period):
    angle = 2.0 * math.pi * (value / period)
    return math.sin(angle), math.cos(angle)


def generate_row(row_id):
    origin, destination = random_city_pair()
    distance_km = haversine_km(CITY_COORDS[origin], CITY_COORDS[destination])

    anchor = random_anchor_date()
    dow = anchor.weekday()  # 0=Mon .. 6=Sun
    doy = anchor.timetuple().tm_yday
    is_weekend = dow >= 5
    dow_sin, dow_cos = cyclical(dow, 7)
    doy_sin, doy_cos = cyclical(doy, 365)

    route_weight = CITY_WEIGHT[origin] + CITY_WEIGHT[destination]  # 2..6

    # ---- synthetic "recent activity" (see module docstring: at serving
    # time these two numbers come from real Load documents instead) ----
    mean_recent_14d = 1.1 * route_weight + 1.5
    recent_load_count_14d = max(0, round(random.gauss(mean_recent_14d, mean_recent_14d * 0.45)))
    mean_extra_half = mean_recent_14d * 0.85
    extra_earlier_half = max(0, round(random.gauss(mean_extra_half, mean_extra_half * 0.45)))
    recent_load_count_30d = recent_load_count_14d + extra_earlier_half

    # ---- label: a 7-day-ahead predicted load count on this route ----
    base_demand = route_weight * 2.2
    proximity_bonus = max(0.0, 1.0 - distance_km / 1400.0) * 5.0  # closer routes get shuttled more often
    momentum = 0.55 * recent_load_count_14d + 0.22 * extra_earlier_half
    weekend_effect = -1.8 if is_weekend else 0.6  # fewer NEW postings land on a weekend
    # Arbitrary, documented seasonal bump peaking around day-of-year 275
    # (~early October) -- stands in for a real festival/harvest-season
    # freight bump a logistics dataset would actually show.
    seasonal = 2.5 * math.sin(2.0 * math.pi * (doy - 275) / 365.0)
    noise = random.gauss(0, 2.2)

    raw = base_demand + proximity_bonus + momentum + weekend_effect + seasonal + noise
    predicted_load_count_7d = max(0.0, raw)

    return {
        "row_id": row_id,
        "origin": origin,
        "destination": destination,
        "distance_km": round(distance_km, 1),
        "anchor_date": anchor.date().isoformat(),
        "dow_sin": round(dow_sin, 4),
        "dow_cos": round(dow_cos, 4),
        "doy_sin": round(doy_sin, 4),
        "doy_cos": round(doy_cos, 4),
        "is_weekend": str(is_weekend),
        "recent_load_count_14d": recent_load_count_14d,
        "recent_load_count_30d": recent_load_count_30d,
        # Debug/report only -- NOT fed to the model as a feature:
        "route_weight": route_weight,
        "predicted_load_count_7d": round(predicted_load_count_7d, 2),
    }


def main():
    rows = [generate_row(i) for i in range(N_ROWS)]

    labels = [r["predicted_load_count_7d"] for r in rows]
    labels_sorted = sorted(labels)
    low_max = labels_sorted[int(len(labels_sorted) * 0.33)]
    medium_max = labels_sorted[int(len(labels_sorted) * 0.66)]
    print(f"Generated {len(rows)} synthetic route/date samples.")
    print(f"Label range: {min(labels):.1f} .. {max(labels):.1f}, mean {sum(labels)/len(labels):.2f}")
    print(f"Tertile category thresholds: Low <= {low_max:.2f} < Medium <= {medium_max:.2f} < High")

    out_path = "data/synthetic_demand.csv"
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
