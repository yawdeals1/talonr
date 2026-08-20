import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireUuidParam } from "../../lib/validate-params.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  connectToken,
  create,
  get,
  list,
  loginScript,
  remove,
  revalidate,
  saveSession,
  update,
} from "./accounts.controller.js";

export const accountsRouter = Router();

// Deliberately ahead of requireAuth below (and listed in app.ts's PUBLIC_API_PATHS) — this is
// where scripts/login.ts posts a captured X session back from a machine that has no Deploro
// session, and may not even have this repo. It authenticates itself with a short-lived,
// account-scoped connect token instead (see connectToken route + lib/connect-token.ts).
accountsRouter.post("/session", asyncHandler(saveSession));

// Also ahead of requireAuth (and in PUBLIC_API_PATHS) — this serves scripts/login.ts's own source,
// which holds no secrets (it's the same file already public in the repo). Gating it behind the
// browser's session cookie broke the one thing that needed to fetch it: a plain terminal command
// (curl/Invoke-WebRequest) run from a machine that was never logged into the web app at all.
accountsRouter.get("/login-script", asyncHandler(loginScript));

accountsRouter.use(requireAuth);
accountsRouter.get("/", asyncHandler(list));
accountsRouter.get("/:id", requireUuidParam("id"), asyncHandler(get));
accountsRouter.get("/:id/connect-token", requireUuidParam("id"), asyncHandler(connectToken));
accountsRouter.post("/", asyncHandler(create));
accountsRouter.post("/:id/revalidate", requireUuidParam("id"), asyncHandler(revalidate));
accountsRouter.patch("/:id", requireUuidParam("id"), asyncHandler(update));
accountsRouter.delete("/:id", requireUuidParam("id"), asyncHandler(remove));
