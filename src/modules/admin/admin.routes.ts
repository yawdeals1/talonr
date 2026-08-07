import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireUuidParam } from "../../lib/validate-params.js";
import { requireAdmin, requireAuth } from "../auth/auth.middleware.js";
import { activity, scrapeJobs, userAccounts, users } from "./admin.controller.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);
adminRouter.get("/users", asyncHandler(users));
adminRouter.get("/users/:id/accounts", requireUuidParam("id"), asyncHandler(userAccounts));
adminRouter.get("/scrape-jobs", asyncHandler(scrapeJobs));
adminRouter.get("/activity", asyncHandler(activity));
