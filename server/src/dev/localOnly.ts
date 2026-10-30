import type { IncomingMessage } from 'http';
import type { NextFunction, Request, Response } from 'express';

const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3001', 'http://127.0.0.1:3001']);

/** Shell and file access are only ever offered to this machine's own browser. */
export function isLocalRequest(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  const origin = req.headers.origin;
  return loopback && (!origin || ALLOWED_ORIGINS.has(origin));
}

export function localOnly(req: Request, res: Response, next: NextFunction) {
  if (!isLocalRequest(req)) {
    res.status(403).json({ success: false, error: 'The development workspace is only available from this machine.' });
    return;
  }
  next();
}
