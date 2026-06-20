import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./middlewares/error-handler";

const app: Express = express();
// Behind Render's proxy — needed so rate-limit keys on the real client IP.
app.set("trust proxy", 1);

// Comma-separated allowlist via CORS_ORIGINS; sensible localhost defaults for dev.
const corsOrigins = (process.env["CORS_ORIGINS"] ?? "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Basic abuse / quota-exhaustion guard on the open API. Generous enough for
// normal use; the health probes are cheap and stay well under the limit.
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env["RATE_LIMIT_PER_MIN"] ?? 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please slow down and try again shortly." },
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: corsOrigins }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", apiLimiter, router);

app.use(errorHandler);

export default app;
