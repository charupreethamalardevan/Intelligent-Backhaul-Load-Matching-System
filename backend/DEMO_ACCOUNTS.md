# Demo accounts

Run once from `backend/`:

```
npm run seed:demo
```

This creates the 5 accounts below (if they don't exist yet) and gives each
one realistic history -- vehicles, trips, posted loads, and booking
requests at a mix of completed/rejected/in-progress stages -- so logging in
immediately shows a populated dashboard instead of an empty one.

| Role | Email | Password |
|---|---|---|
| Fleet Owner | `demo.fleetowner@iblms.test` | `Demo@12345` |
| Individual Owner (owner-driver) | `demo.ownerdriver@iblms.test` | `Demo@12345` |
| Fleet Driver | `demo.driver@iblms.test` | `Demo@12345` |
| Business Poster | `demo.business@iblms.test` | `Demo@12345` |
| Individual Poster | `demo.individual@iblms.test` | `Demo@12345` |

Notes:
- The Fleet Driver account is already linked to the Fleet Owner account
  above and already has one vehicle assigned to it, so it can request
  loads immediately (per the two-stage approval gate, any request it
  makes still needs the Fleet Owner's approval first) -- and it already
  has one completed delivery in its own request history.
- This is separate from `npm run seed`, which only adds history to
  accounts *you* signed up and approved yourself. This script creates its
  own fixed accounts specifically so you have something to log into right
  away, without waiting on signup/approval.
- Safe to re-run -- re-running reuses the same 5 accounts rather than
  duplicating them, and only adds history to whichever ones don't have any
  yet.
