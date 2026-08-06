import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { cancel, create, get, list } from "./scrapes.controller.js";

export const scrapesRouter = Router();

scrapesRouter.use(requireAuth);
scrapesRouter.post("/", asyncHandler(create));
scrapesRouter.get("/", asyncHandler(list));
scrapesRouter.get("/:id", asyncHandler(get));
scrapesRouter.post("/:id/cancel", asyncHandler(cancel));
