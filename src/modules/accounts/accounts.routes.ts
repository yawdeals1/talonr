import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { create, get, list, remove, update } from "./accounts.controller.js";

export const accountsRouter = Router();

accountsRouter.use(requireAuth);
accountsRouter.get("/", asyncHandler(list));
accountsRouter.get("/:id", asyncHandler(get));
accountsRouter.post("/", asyncHandler(create));
accountsRouter.patch("/:id", asyncHandler(update));
accountsRouter.delete("/:id", asyncHandler(remove));
