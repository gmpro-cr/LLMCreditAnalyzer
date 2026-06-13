import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const PYTHON_URL = () => process.env["PYTHON_SERVICE_URL"] ?? "http://127.0.0.1:8000";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
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
