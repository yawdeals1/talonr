import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ValidationError } from "./errors.js";

/** Rejects a route param that isn't a UUID before it reaches the service layer. */
export function requireUuidParam(paramName: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = z.string().uuid().safeParse(req.params[paramName]);
    if (!result.success) {
      next(new ValidationError(`${paramName} must be a valid id`));
      return;
    }
    next();
  };
}
