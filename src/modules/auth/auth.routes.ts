import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { login, logout, me, register } from "./auth.controller.js";
import { requireAuth } from "./auth.middleware.js";

export const authRouter = Router();

authRouter.post("/register", asyncHandler(register));
authRouter.post("/login", asyncHandler(login));
authRouter.post("/logout", requireAuth, asyncHandler(logout));
authRouter.get("/me", requireAuth, asyncHandler(me));
