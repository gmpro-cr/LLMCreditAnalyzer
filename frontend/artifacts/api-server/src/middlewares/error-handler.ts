import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger";

/**
 * Global error handler. Express 5 forwards rejected async handlers here.
 * ZodError -> 400 with field-level details; everything else -> 500 with a
 * generic message (full error goes to the log, never to the client).
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

  // Body-parser and friends attach a 4xx status (e.g. malformed JSON) — honor it.
  const status = typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) {
    logger.error({ err, url: req.url, method: req.method }, "Unhandled error");
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  res.status(status).json({ error: err.message ?? "Bad request" });
};
