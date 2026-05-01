# Offshore League

Production-minded MVP for a real-money, skill-based fishing competition platform.

## Run Locally

```bash
npm install
npm run dev
```

Frontend: http://localhost:5173  
Backend API: http://localhost:4000

## Stripe Setup

Create `.env` from `.env.example` and set:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
CLIENT_URL=http://localhost:5173
ADMIN_EMAILS=you@example.com
```

`ADMIN_EMAILS` is a comma-separated allowlist for admin routes.
Only listed emails can access `/api/admin/*` and the `/admin` page operations.

The app creates a real Stripe-hosted Checkout Session and redirects users to `checkout.stripe.com`. The challenge code is created only after Stripe reports the session as paid. For local webhook testing, forward Stripe events to:

```bash
stripe listen --forward-to localhost:4000/api/stripe/webhook
```

## Useful Commands

```bash
npm run build
npm run dev:server
npm run restart:server
npm run dev:client
```

`npm run restart:server` is the safer way to restart the API on Windows.
It only stops the process on port `4000` when it is a Node process running `server/index.js`.
If another process is using the port, it refuses to kill it.

SQLite is created automatically at `server/db/offshore-league.sqlite`. Uploaded media is stored in `server/uploads`.

## Deploy (Frontend + Backend)

This repo is configured to deploy as a single Node service that serves both:

- API routes at `/api/*`
- Built React frontend from `client/dist`

The deployment blueprint is in `render.yaml`.

### Render

1. Push this repo to GitHub.
2. In Render, choose **New +** -> **Blueprint**.
3. Select this repository and apply the `render.yaml` blueprint.
4. Set required environment variables in Render:
	- `CLIENT_URL=https://app.offshoreleague.com`
	- `VITE_STRIPE_PUBLISHABLE_KEY`
	- `STRIPE_SECRET_KEY`
	- `STRIPE_WEBHOOK_SECRET`
	- `ADMIN_EMAILS`
5. Keep `OFFSHORE_DB_PATH=/var/data/offshore/offshore-league.sqlite` so SQLite uses the attached persistent disk.
6. After deploy, copy the Render URL (for example: `https://offshore-league.onrender.com`).

### Vercel Frontend -> External Backend Wiring

If your frontend is deployed on Vercel and backend is deployed elsewhere, set one variable in the Vercel project:

- `VITE_API_URL=https://your-backend-host`

Then redeploy the frontend. The app will automatically route all `/api/*` and `/uploads/*` requests to that backend host.

### Spaceship DNS

After Render is live, create:

- `CNAME` host `app` -> your Render hostname (without `https://`)
- `URL Redirect` host `@` -> `https://app.offshoreleague.com` (301)
- `CNAME` host `www` -> `app.offshoreleague.com`

Then update Render environment variable `CLIENT_URL` to `https://app.offshoreleague.com` if needed and redeploy once.

## Submission Media Pipeline

- Upload destination: `server/uploads`
- Default max video size: `512MB` (override with `SUBMISSION_MAX_VIDEO_BYTES`)
- Default retention policy: `120 days` (override with `SUBMISSION_MEDIA_RETENTION_DAYS`)
- Server receipt returned on successful submission: receipt code, server timestamp, storage and retention details, captured metadata (file size + uploader device type), and catch context.

## Entry Integrity

- One account per email is enforced at registration.
- One entry per account per challenge is enforced server-side and at database level.
- Terms acceptance is stored with account ID, terms version, IP, user-agent, and source before checkout.

API helpers:

- `GET /api/terms/current`
- `GET /api/terms/status` (auth required)
- `POST /api/terms/accept` (auth required)

## Magic Link Login

Login by email link is available in addition to password login.

- `POST /api/auth/magic-link/request`
- `POST /api/auth/magic-link/verify`

Default link TTL is 20 minutes (`MAGIC_LINK_TTL_MINUTES`).

## Data Layer Coverage

Each submission can now persist a full catch context in addition to species and verified measurements:

- `caughtAt` (optional ISO timestamp for when fish was caught)
- `catchLocation` (optional free-text location)
- `catchLatitude` / `catchLongitude` (optional coordinate pair)
- `catchWeather` (optional JSON payload or summary text)

Admin metrics now include participation analytics fields:

- `conversionRate` (successful checkouts divided by entries)
- `uniqueEntrants`
- `repeatEntrants`
- `repeatRate`
