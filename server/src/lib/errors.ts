import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';

/** An error whose message is safe to show to the client. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Extra fields sent with the error, e.g. `{ reauth: 'uos' }` so the web app knows to re-enter through UOS. */
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const forbidden = (m = 'Access denied.') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);

/** Express 4 does not catch rejected promises - wrap every async route. */
export function ah<R extends Request = Request>(
  fn: (req: R, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req as R, res, next).catch(next);
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ ...err.extra, error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field = first?.path.join('.') || 'request';
    res.status(400).json({ error: `${field}: ${first?.message ?? 'invalid'}`, issues: err.issues });
    return;
  }
  const e = err as { type?: string; status?: number };
  if (e && e.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request is too large.' });
    return;
  }
  if (e && e.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body.' });
    return;
  }
  // Internal errors (SQL, runtime) are logged, never leaked to the client.
  console.error('Unhandled API error', err);
  res.status(500).json({ error: 'Server error. Please try again.' });
}
