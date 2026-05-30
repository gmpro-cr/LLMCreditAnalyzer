# CreditGuard AI — Free-Tier Deployment Runbook

Four components, all on free tiers:

| Component | Host | URL (after deploy) |
|---|---|---|
| Vite SPA (`frontend/artifacts/creditguard`) | **Vercel** | `https://creditguard-ai.vercel.app` |
| Express api-server (`frontend/artifacts/api-server`) | **Render** | `https://creditguard-api.onrender.com` |
| Python FastAPI engine (`python-service`) | **Render** | `https://creditguard-python.onrender.com` |
| Postgres | **Supabase** | (already provisioned) |

Data flow: **SPA → api-server → (Supabase + Python engine) → Gemini / web**.

> ⚠️ Free Render web services **sleep after ~15 min idle**; the first request after
> sleeping takes ~30–50s to wake. Fine for a demo, not for production traffic.

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
   - `creditguard-api` → `SUPABASE_URL` = *(NEXT_PUBLIC_SUPABASE_URL in `.env.local`)*
   - `creditguard-api` → `SUPABASE_SERVICE_ROLE_KEY` = *(from `.env.local`)*
4. Apply. Wait for both to go live. Verify:
   ```bash
   curl https://creditguard-python.onrender.com/health
   curl https://creditguard-api.onrender.com/api/dashboard/stats
   ```

## 3. Deploy the SPA to Vercel
The Vercel project `creditguard-ai` is already linked (`.vercel/project.json`).
1. Vercel project **Settings → General → Root Directory = `frontend`**.
2. Vercel project **Settings → Environment Variables**:
   - `VITE_API_URL` = `https://creditguard-api.onrender.com`  (Production)
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
```bash
# Terminal 1 — Python engine
cd python-service && . venv/bin/activate && uvicorn main:app --reload --port 8000

# Terminal 2 — Express api-server  (reads ../.env.local for Supabase)
cd frontend
SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" PYTHON_SERVICE_URL=http://127.0.0.1:8000 PORT=3001 \
  node --enable-source-maps artifacts/api-server/dist/index.mjs

# Terminal 3 — Vite SPA (proxies /api → :3001)
cd frontend/artifacts/creditguard && node_modules/.bin/vite --port 5173
# open http://localhost:5173
```
For local LLM, `python-service/.env` uses `MEMO_PROVIDER=gemini` with `GEMINI_API_KEY`.
