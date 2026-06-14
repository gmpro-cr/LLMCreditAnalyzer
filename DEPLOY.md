# CreditGuard AI — Free-Tier Deployment Runbook

Four components, all on free tiers:

| Component | Host | URL (after deploy) |
|---|---|---|
| Vite SPA (`frontend/artifacts/creditguard`) | **Vercel** | `https://creditguard-ai.vercel.app` |
| Express api-server (`frontend/artifacts/api-server`) | **Render** | `https://creditguard-api.onrender.com` |
| Python FastAPI engine (`python-service`) | **Render** | `https://creditguard-python.onrender.com` |
| Postgres | **Supabase** | (already provisioned) |

Data flow: **SPA → (Supabase Auth) → api-server → (Supabase RLS + Python engine) → Gemini / web**.

> ⚠️ Free Render web services **sleep after ~15 min idle**; the first request after
> sleeping takes ~30–50s to wake. Fine for a demo, not for production traffic.

---

## 0. Security setup (do this first)

1. **Rotate the Supabase service-role key.** A previous key was committed to the
   repo history. In Supabase → **Settings → API → Service role**, regenerate it,
   and use the new value everywhere below. (The old value is now useless once rotated.)
2. **Apply the schema migration** in Supabase → **SQL Editor**: run
   `migrations/0001_documented_schema_and_rls.sql`. This adds `cases.user_id`,
   documents the real tables, and enables Row Level Security. (Pre-existing rows
   get `user_id = NULL` and become invisible — backfill them to an owner if needed.)
3. **Enable auth providers** in Supabase → **Authentication → Providers**: turn on
   **Email** (and **Google** if you want the "Continue with Google" button). For
   Google, add your Vercel domain + `https://<project>.supabase.co/auth/v1/callback`
   to the allowed redirect URLs.
4. **Storage bucket** `case-documents` should exist (Data Room uploads).

---

## Prerequisites
- Code pushed to GitHub `gmpro-cr/LLMCreditAnalyzer` (Render + Vercel pull from there).
- A Google **Gemini API key** (already in `python-service/.env`).
- Supabase URL + service-role key (already in `.env.local`).

---

## 1. Push the consolidated repo to GitHub
GitHub currently holds the *old* Next.js version. This is a clean fast-forward.

```bash
git push origin main
```

## 2. Deploy both backends to Render (Blueprint)
1. Render dashboard → **New → Blueprint** → connect `gmpro-cr/LLMCreditAnalyzer`.
2. Render reads `render.yaml` and proposes **creditguard-python** + **creditguard-api**.
3. Before "Apply", set the secret env vars (marked `sync: false`):
   - `creditguard-python` → `GEMINI_API_KEY` = *(from `python-service/.env`)*
   - `creditguard-python` → `CORS_ORIGIN_REGEX` = e.g. `https://creditguard-ai.*\.vercel\.app` (your project's preview/prod pattern)
   - `creditguard-api` → `SUPABASE_URL` = *(NEXT_PUBLIC_SUPABASE_URL in `.env.local`)*
   - `creditguard-api` → `SUPABASE_SERVICE_ROLE_KEY` = *(the **rotated** key)*
   - `creditguard-api` → `SUPABASE_ANON_KEY` = *(Supabase → Settings → API → anon/public)*
   - `creditguard-api` → `CORS_ORIGINS` = your Vercel URL, e.g. `https://creditguard-ai.vercel.app`
   - `INTERNAL_API_TOKEN` is **auto-generated** and shared between the two services
     via the `creditguard-internal` env-var group — no manual entry needed. (If setting
     it by hand, the value MUST be identical on both services.)
4. Apply. Wait for both to go live. Verify:
   ```bash
   curl https://creditguard-python.onrender.com/health
   curl https://creditguard-api.onrender.com/api/dashboard/stats
   ```

## 3. Deploy the SPA to Vercel
The Vercel project `creditguard-ai` is already linked (`.vercel/project.json`).
1. Vercel project **Settings → General → Root Directory = `frontend`**.
2. Vercel project **Settings → Environment Variables** (all `Production` + `Preview`):
   - `VITE_API_URL` = `https://creditguard-api.onrender.com`
   - `VITE_SUPABASE_URL` = *(Supabase project URL)*
   - `VITE_SUPABASE_ANON_KEY` = *(Supabase anon/public key)*

   These are injected at **build time**, so changing them requires a redeploy.
3. Deploy:
   ```bash
   cd frontend && vercel --prod
   ```
   (or push to `main` if the project is Git-connected)

## 4. Smoke-test the live demo
- Open the Vercel URL.
- Dashboard loads (api-server + Supabase reachable).
- "Add Case" → company search returns NSE/BSE hits (Python + Yahoo).
- Generate a CAM section → Gemini-backed memo text appears.

---

## Local development

Easiest: `./dev.sh` starts all three servers and wires env from `.env.local`.
It derives `SUPABASE_ANON_KEY` and `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
from the existing `NEXT_PUBLIC_SUPABASE_*` values, so make sure those are present
in `.env.local`. `INTERNAL_API_TOKEN` is left unset locally (the Python engine
skips the shared-secret check when it is empty).

> Rebuild the api-server after TS changes: `cd frontend && pnpm --filter @workspace/api-server build`.

Manual (three terminals):
```bash
# Terminal 1 — Python engine
cd python-service && . venv/bin/activate && uvicorn main:app --reload --port 8000

# Terminal 2 — Express api-server (reads ../.env.local for Supabase)
cd frontend
SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  PYTHON_SERVICE_URL=http://127.0.0.1:8000 PORT=3001 \
  node --enable-source-maps artifacts/api-server/dist/index.mjs

# Terminal 3 — Vite SPA (proxies /api → :3001)
cd frontend/artifacts/creditguard \
  VITE_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" VITE_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  node_modules/.bin/vite --port 5173
# open http://localhost:5173
```
For local LLM, `python-service/.env` uses `MEMO_PROVIDER=gemini` with `GEMINI_API_KEY`.
