import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireUuidParam } from "../../lib/validate-params.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { connectToken, create, get, list, loginScript, remove, saveSession, update } from "./accounts.controller.js";

export const accountsRouter = Router();

// Deliberately ahead of requireAuth below (and listed in app.ts's PUBLIC_API_PATHS) — this is
// where scripts/login.ts posts a captured X session back from a machine that has no Deploro
// session, and may not even have this repo. It authenticates itself with a short-lived,
// account-scoped connect token instead (see connectToken route + lib/connect-token.ts).
accountsRouter.post("/session", asyncHandler(saveSession));

accountsRouter.use(requireAuth);
accountsRouter.get("/", asyncHandler(list));
// Must come before "/:id" — both are one-segment GETs, and requireUuidParam would otherwise
// reject "login-script" as a bad :id before this ever matches.
accountsRouter.get("/login-script", asyncHandler(loginScript));
accountsRouter.get("/:id", requireUuidParam("id"), asyncHandler(get));
accountsRouter.get("/:id/connect-token", requireUuidParam("id"), asyncHandler(connectToken));
accountsRouter.post("/", asyncHandler(create));
accountsRouter.patch("/:id", requireUuidParam("id"), asyncHandler(update));
accountsRouter.delete("/:id", requireUuidParam("id"), asyncHandler(remove));
