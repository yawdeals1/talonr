import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireUuidParam } from "../../lib/validate-params.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { bulkRemove, get, list, remove } from "./leads.controller.js";

export const leadsRouter = Router();

leadsRouter.use(requireAuth);
leadsRouter.get("/", asyncHandler(list));
leadsRouter.post("/bulk-delete", asyncHandler(bulkRemove));
leadsRouter.get("/:id", requireUuidParam("id"), asyncHandler(get));
leadsRouter.delete("/:id", requireUuidParam("id"), asyncHandler(remove));
