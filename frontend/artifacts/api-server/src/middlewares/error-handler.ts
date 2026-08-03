import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger";
import { isDatabaseUnavailable, isUpstreamUnavailable } from "../lib/upstream-error";

/**
 * Global error handler. Express 5 forwards rejected async handlers here.
 * ZodError -> 400 with field-level details; an unreachable dependency -> 503
 * with a machine-readable `code`; everything else -> 500 with a generic
 * message (full error goes to the log, never to the client).
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  // An unreachable dependency is not our bug and is worth retrying, so it gets
  // a 503 and a stable code rather than being flattened into "Internal server
  // error". The response deliberately names no host, vendor or key — the
  // diagnosis stays in the log.
  if (isDatabaseUnavailable(err)) {
    logger.error({ err, url: req.url, method: req.method }, "Database unreachable — is the Supabase project paused?");
    res.status(503).json({
      error: "The database is temporarily unavailable. Please try again shortly.",
      code: "database_unavailable",
    });
    return;
  }

  if (isUpstreamUnavailable(err)) {
    logger.error({ err, url: req.url, method: req.method }, "Upstream service unreachable");
    res.status(503).json({
      error: "An upstream service is temporarily unavailable. Please try again shortly.",
      code: "upstream_unavailable",
    });
    return;
  }

  // Body-parser and friends attach a 4xx status (e.g. malformed JSON) — honor it.
  const status = typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) {
    logger.error({ err, url: req.url, method: req.method }, "Unhandled error");
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  res.status(status).json({ error: err.message ?? "Bad request" });
};
