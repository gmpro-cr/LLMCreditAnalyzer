import type { RequestHandler } from "express";
import { createUserClient, getUserFromToken } from "../lib/supabase-db.js";
import { logger } from "../lib/logger";

/**
 * Requires a valid Supabase access token (Authorization: Bearer <jwt>).
 * On success attaches `req.userId` and a per-request, user-scoped Supabase
 * client `req.db` whose every query runs under RLS as that user.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const user = await getUserFromToken(token);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = user.id;
    req.db = createUserClient(token);
    next();
  } catch (err) {
    logger.warn({ err }, "Auth verification failed");
    res.status(401).json({ error: "Unauthorized" });
  }
};
