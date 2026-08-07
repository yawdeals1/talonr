import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireUuidParam } from "../../lib/validate-params.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { create, get, list, remove, update } from "./accounts.controller.js";

export const accountsRouter = Router();

accountsRouter.use(requireAuth);
accountsRouter.get("/", asyncHandler(list));
accountsRouter.get("/:id", requireUuidParam("id"), asyncHandler(get));
accountsRouter.post("/", asyncHandler(create));
accountsRouter.patch("/:id", requireUuidParam("id"), asyncHandler(update));
accountsRouter.delete("/:id", requireUuidParam("id"), asyncHandler(remove));
