---
name: verify
description: Build, run and drive the CreditGuardAI api-server over HTTP to verify a change at its real surface (the socket), including database-outage and missing-row behaviour.
---

# Verifying api-server changes

The surface is the socket. Build the bundle, run it, send requests, read
responses. Don't verify by running typecheck.

## Build and launch

`dev`/`start` scripts assume a full workspace install; the bundle is
self-contained, so drive it directly:

```bash
cd frontend/artifacts/api-server
node ./build.mjs                       # esbuild -> dist/index.mjs
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=dummy PORT=5199 NODE_ENV=production \
  CORS_ORIGINS=http://localhost:5173 node ./dist/index.mjs
```

`PORT` is **required** — the process throws on startup without it.
Poll `GET /api/healthz` until it answers rather than sleeping a fixed time.

## Driving without a real database

Supabase is on the free tier and pauses when idle, so it is frequently
unreachable and can't be relied on for verification. Point `SUPABASE_URL` at
a local stub instead — supabase-js only needs the PostgREST shape:

- `GET /rest/v1/<table>?select=...` → JSON array; set `content-range: 0-N/N`.
- `HEAD` request → no body, count in `content-range` (this is what
  `select(..., { count: "exact", head: true })` in `/api/db-health` issues).
- `.single()` sends `Accept: application/vnd.pgrst.object+json` and expects a
  bare object.

Four states worth driving, because the interesting bugs here are all about
**telling the truth when the database is not there**:

| State | `SUPABASE_URL` / stub | Expect |
|---|---|---|
| unreachable | any NXDOMAIN host | 503 `database_unavailable`; `/api/healthz` still 200 |
| healthy | stub returning rows | 200 with data |
| Postgres error | stub returning 400 + `{code:"42P01",message,details,hint}` | 500 — **not** 503 |
| row absent | stub returning 406 + `{code:"PGRST116",...}` | 404 |

The last two exist to catch over-broad error classification: a real SQL error
must not be reported as an outage, and a missing row must not be either.

## Gotchas

- Killing the stub and the server share a cleanup path easily — kill only the
  server between states, or the "healthy" state silently becomes "unreachable"
  and every probe lies.
- `facilityType` is an enum (`term_loan`, `working_capital`,
  `letter_of_credit`, `bank_guarantee`, `overdraft`); `POST /api/cases` also
  requires `rmName`. A wrong value returns a Zod 400 that looks like a failure
  of whatever you were actually testing.
- Zod validation runs before any database call, so 400s are the right answer
  even while the database is down — useful as an ordering check.

A worked harness covering all four states lives in the scratchpad of the
2026-08-03 session (`verify-all.sh` + `mock-supabase.mjs`); rebuild it from
this description if it's gone.
