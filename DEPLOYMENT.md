# Deploying IBLMS -- step-by-step guide

Stack: **MongoDB Atlas** (free, database) + **Render** (free, backend API +
ml-service) + **Vercel** (free, frontend). All three are free tiers, no
credit card required for any of them. Total cost: $0/month.

I prepped the repo for this (see "What's already done" below) but the
account-creation and dashboard-clicking steps below have to be done by you
-- I can't create third-party accounts on your behalf.

---

## What's already done (no action needed)

- `frontend/src/lib/api.js` reads the backend URL from `VITE_API_BASE`
  instead of a hardcoded `localhost:5000`.
- `backend/.env.example` and `frontend/.env.example` document every
  environment variable the app needs.
- `ml-service/app.py` now binds to Render's injected `$PORT`, and
  `ml-service/requirements.txt` includes `gunicorn` for production serving.
- `render.yaml` at the repo root is a **Render Blueprint** that creates
  both backend services (Node API + Python ml-service) in one step.
- `frontend/vercel.json` adds the rewrite rule your React Router routes
  (`/login`, `/dashboard`, `/admin`, ...) need so refreshing or
  deep-linking into them doesn't 404.
- `.gitignore` now excludes a handful of stray build artifacts
  (`dist_verify/`, old video `.bak`/scratch files, timestamp configs) that
  had piled up so they don't bloat the repo.

---

## Step 0 -- push the repo to GitHub

Your repo already has a GitHub remote
(`charupreethamalardevan/Intelligent-Backhaul-Load-Matching-System`), but
it's two commits behind everything we've built since -- 120+ changed/new
files are only on your machine right now. Render and Vercel both deploy
*from GitHub*, so this has to happen first. Ask me in chat when you're
ready and I'll commit and push everything (I won't do it without you
saying go, since it changes your GitHub repo).

---

## Step 1 -- MongoDB Atlas (the database)

1. Go to <https://www.mongodb.com/cloud/atlas/register> and create a free
   account.
2. Create a free cluster: choose the **M0 Free** tier, any cloud
   provider/region close to you, and give it a name (e.g. `iblms`).
3. **Database Access** (left sidebar) -> Add New Database User. Pick a
   username and a strong password (write the password down, you'll need
   it in a second). Give it "Read and write to any database".
4. **Network Access** (left sidebar) -> Add IP Address -> **Allow Access
   From Anywhere** (`0.0.0.0/0`). This is the simplest option for a
   project like this since Render's outbound IPs aren't fixed on the free
   plan; it does mean the database is reachable from anywhere on the
   internet, but it's still protected by the username/password from step 3.
5. **Database** (left sidebar) -> Connect -> Drivers -> copy the
   connection string. It looks like:
   `mongodb+srv://<username>:<password>@iblms.xxxxx.mongodb.net/?retryWrites=true&w=majority`
6. Edit it: put in your real username/password from step 3, and add a
   database name before the `?`, e.g.
   `mongodb+srv://myuser:mypassword@iblms.xxxxx.mongodb.net/iblms?retryWrites=true&w=majority`
   Save this full string somewhere -- it's your `MONGO_URI`.

---

## Step 2 -- Render (backend + ml-service)

1. Go to <https://render.com> and sign up (you can sign up with GitHub,
   which also makes the next step easier).
2. Dashboard -> **New +** -> **Blueprint**.
3. Connect your GitHub account if asked, then pick the
   `Intelligent-Backhaul-Load-Matching-System` repo. Render will find
   `render.yaml` at the repo root and show you the two services it
   defines: `iblms-backend` and `iblms-ml-service`.
4. It will prompt you to fill in a few values before creating them:
   - `MONGO_URI` -> the full connection string from Step 1.
   - `JWT_SECRET` -> leave blank, Render generates a random one for you.
   - `FRONTEND_ORIGIN` -> leave blank for now, you'll set this in Step 4.
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD` -> pick your own admin login for
     the `/admin` page.
   - `ML_SERVICE_URL` -> leave blank for now, you'll set this next.
5. Click **Apply**. Render builds and deploys both services -- this takes
   a few minutes the first time. When it's done, open each service's page
   and copy its URL from the top (something like
   `https://iblms-backend-xxxx.onrender.com` and
   `https://iblms-ml-service-xxxx.onrender.com`).
6. Go to `iblms-backend` -> **Environment** tab -> edit `ML_SERVICE_URL`,
   paste in the `iblms-ml-service` URL from step 5, save. Render
   auto-restarts the service with the new value.

Keep the `iblms-backend` URL handy -- you'll need `<that URL>/api` as the
frontend's `VITE_API_BASE` in the next step.

---

## Step 3 -- Vercel (frontend)

1. Go to <https://vercel.com> and sign up (GitHub sign-in works here too).
2. Dashboard -> **Add New** -> **Project** -> import the same GitHub repo.
3. Vercel will ask for the project's root directory -- set it to
   `frontend` (this is a monorepo with backend/frontend/ml-service all in
   one repo, so this step matters). It should then auto-detect the
   framework as **Vite** and fill in `npm run build` / `dist` for you.
4. Before deploying, expand **Environment Variables** and add:
   - `VITE_API_BASE` = `https://iblms-backend-xxxx.onrender.com/api`
     (your actual backend URL from Step 2, with `/api` on the end, no
     trailing slash after that).
5. Click **Deploy**. When it finishes you'll get a URL like
   `https://your-project.vercel.app`.

---

## Step 4 -- close the loop (CORS)

The backend only accepts requests from one configured frontend origin.
Now that you have the Vercel URL:

1. Back in Render -> `iblms-backend` -> **Environment** -> edit
   `FRONTEND_ORIGIN` -> paste your Vercel URL exactly (e.g.
   `https://your-project.vercel.app`, **no trailing slash**) -> save.
2. Render restarts the backend automatically with the new value.

---

## Step 5 -- seed demo accounts (optional)

If you want the same demo login accounts in production that you used
locally (`backend/DEMO_ACCOUNTS.md`), the easiest way is to run the seed
script from your own machine, pointed at the production database, since
Render's free plan doesn't include shell access to a running service:

```bash
cd backend
# temporarily set MONGO_URI to your Atlas connection string from Step 1
MONGO_URI="mongodb+srv://...your atlas string.../iblms?retryWrites=true&w=majority" npm run seed:demo
```

This writes the demo users directly into your production Atlas database.
Skip this step if you'd rather have users sign up fresh.

---

## Step 6 -- smoke test

Open your Vercel URL and check, in order:

1. Landing page loads, hero video plays.
2. Sign up a new account (or log in with a demo account) -- confirms
   frontend -> backend -> database all actually connected.
3. Fleet dashboard: Trip Planner, create a trip, then (once a booking
   request exists and is live) click the trip row -- it should jump to
   Current Trip and highlight the right booking.
4. Current Trip: open Simulate on a live booking -- the big modal should
   appear and step through statuses every ~2.2s.
5. History: confirm there are no action buttons, just read-only rows.
6. Payments: confirm a completed booking shows up there.
7. `/admin` (typed directly in the URL bar): log in with the
   `ADMIN_USERNAME`/`ADMIN_PASSWORD` you set in Step 2.

**One thing to expect and not worry about:** Render's free plan puts a
service to sleep after 15 minutes with no traffic, and the first request
after that takes about a minute to wake it back up. If a demo/viva
audience hits the site cold, the very first click may hang for ~30-60
seconds before anything shows up -- that's normal free-tier behavior, not
a bug. Loading it yourself a minute before a demo avoids this.

---

## Free-tier limits worth knowing

- **Render**: 750 free instance-hours per month shared across your
  services; sleeping services don't count against that, so two
  intermittently-used free services comfortably fit. Each free service
  sleeps after 15 min idle and takes ~1 min to wake.
- **MongoDB Atlas M0**: 512MB storage, shared compute, no time limit (not
  a trial) but it's the smallest tier -- fine for a project like this.
- **Vercel free (Hobby)**: generous bandwidth/build limits for personal
  projects; the frontend is a static build so it's effectively free to
  serve.

## What I can't do for you

I can't create the MongoDB Atlas, Render, or Vercel accounts, or enter
any payment details -- that has to be you, in your own browser. Once
you've got the three accounts and have pasted in the one piece of
information each step above asks for, everything else (the blueprint, the
env vars, the config files) is already set up to just work.
