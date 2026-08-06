import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { create, evaluate, get, list, remove, update } from "./lead-lists.controller.js";

export const leadListsRouter = Router();

leadListsRouter.use(requireAuth);
leadListsRouter.get("/", asyncHandler(list));
leadListsRouter.post("/", asyncHandler(create));
leadListsRouter.get("/:id", asyncHandler(get));
leadListsRouter.patch("/:id", asyncHandler(update));
leadListsRouter.delete("/:id", asyncHandler(remove));
leadListsRouter.get("/:id/leads", asyncHandler(evaluate));
