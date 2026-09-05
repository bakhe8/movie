import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { tagRequestId } from './observability';

// P0-3: a person reading a Sentry error needs a way to find the matching
// backend log line (and vice versa) without a timestamp-and-guess. A client
// -supplied id is honored so a frontend crash report and the backend
// request it triggered can be correlated by the same id; anything absent or
// implausible gets a fresh one instead of trusting arbitrary client input.
const MAX_LEN = 128;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const requestId = incoming && incoming.length > 0 && incoming.length <= MAX_LEN ? incoming : randomUUID();
  (req as Request & { requestId: string }).requestId = requestId;
  res.setHeader('x-request-id', requestId);
  tagRequestId(requestId);
  next();
}
