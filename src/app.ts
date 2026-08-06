import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { pool } from "./db/client.js";
import { redisConnection } from "./queue/connection.js";
import { errorHandler } from "./lib/errors.js";
import { accountsRouter } from "./modules/accounts/accounts.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { leadListsRouter } from "./modules/lead-lists/lead-lists.routes.js";
import { leadsRouter } from "./modules/leads/leads.routes.js";
import { scrapesRouter } from "./modules/scrapes/scrapes.routes.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.ALLOWED_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    await redisConnection.ping();
    res.json({ status: "ok" });
  } catch (err) {
    res.status(503).json({ status: "unavailable", error: err instanceof Error ? err.message : String(err) });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/scrapes", scrapesRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/lead-lists", leadListsRouter);
app.use("/api/admin", adminRouter);

app.use(errorHandler);
