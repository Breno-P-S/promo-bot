import { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function rotaAsync(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
