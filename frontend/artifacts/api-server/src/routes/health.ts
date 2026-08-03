import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { wakePython } from "../lib/python";
import { supabase } from "../lib/supabase-db.js";

const PYTHON_URL = () => process.env["PYTHON_SERVICE_URL"] ?? "http://127.0.0.1:8000";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Database reachability probe, deliberately separate from /healthz: a paused
// database must not make the service itself look dead to Render.
//
// This endpoint exists to be pinged on a schedule (see keep-warm.yml). Doing so
// serves two purposes: the request counts as Supabase activity, which resets
// the free-tier idle timer that paused the project on 2026-08-03, and a failure
// turns the workflow red within hours instead of the outage being discovered
// weeks later as a 500 in the browser.
router.get("/db-health", async (_req, res) => {
  // `head: true` fetches no rows — the cheapest round trip that still proves
  // DNS, TLS, auth and the table are all fine.
  const { count, error } = await supabase.from("cases").select("id", { count: "exact", head: true });

  if (error) {
    logger.error({ err: error }, "Database health probe failed");
    return res.status(503).json({ status: "unavailable", code: "database_unavailable" });
  }

  return res.json({ status: "ok", cases: count ?? 0 });
});

// Blocking wake: holds the request until the engine is up (or ~120s), so the
// client can show a single "Waking AI engine…" step before a heavy call
// instead of each call independently riding out the cold start.
router.get("/python-wake", async (_req, res) => {
  const awake = await wakePython();
  return res.status(awake ? 200 : 503).json({ awake });
});

// Wakeup probe for the Python engine — called at app load to warm up the
// Render free-tier instance before the user tries to generate a memo.
router.get("/python-health", async (_req, res) => {
  try {
    const resp = await fetch(`${PYTHON_URL()}/health`, {
      signal: AbortSignal.timeout(10000),
    });
    const body = await resp.json();
    return res.status(resp.ok ? 200 : 502).json(body);
  } catch (err) {
    logger.warn({ err }, "Python health probe failed");
    return res.status(503).json({ status: "unavailable" });
  }
});

export default router;
