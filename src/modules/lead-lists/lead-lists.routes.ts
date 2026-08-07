import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireUuidParam } from "../../lib/validate-params.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { create, evaluate, get, list, remove, update } from "./lead-lists.controller.js";

export const leadListsRouter = Router();

leadListsRouter.use(requireAuth);
leadListsRouter.get("/", asyncHandler(list));
leadListsRouter.post("/", asyncHandler(create));
leadListsRouter.get("/:id", requireUuidParam("id"), asyncHandler(get));
leadListsRouter.patch("/:id", requireUuidParam("id"), asyncHandler(update));
leadListsRouter.delete("/:id", requireUuidParam("id"), asyncHandler(remove));
leadListsRouter.get("/:id/leads", requireUuidParam("id"), asyncHandler(evaluate));
