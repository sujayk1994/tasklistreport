import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import { existsSync } from "fs";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
app.set("trust proxy", 1);

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

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.length === 0 ||
        allowedOrigins.some((allowed) => origin.startsWith(allowed))
      ) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
  }),
);

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submit attempts. Try again later." },
});

app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

app.use(clerkMiddleware());

app.use("/api", limiter);
app.use("/api/tasks/today/submit", submitLimiter);
app.use("/api", router);

// ── Production: serve built frontend static files ─────────────────────────────
// The Docker image (and start.sh) set STATIC_DIR to the Vite build output.
if (process.env.NODE_ENV === "production" && process.env.STATIC_DIR) {
  const staticDir = process.env.STATIC_DIR;
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir, { maxAge: "7d", immutable: true }));

    // SPA fallback — send index.html for all non-API routes
    app.use((_req, res) => {
      res.sendFile(path.join(staticDir, "index.html"));
    });

    logger.info({ staticDir }, "Serving static frontend files");
  } else {
    logger.warn({ staticDir }, "STATIC_DIR does not exist — skipping static file serving");
  }
}

export default app;
