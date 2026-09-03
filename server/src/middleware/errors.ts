import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../lib/errors';
import { config } from '../config';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'Endpoint not found.' } });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Some fields need attention.',
        details: error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  const sqliteError = error as { code?: string; message?: string };
  if (typeof sqliteError.code === 'string' && sqliteError.code.startsWith('SQLITE_CONSTRAINT')) {
    res.status(409).json({
      error: { code: 'conflict', message: 'That record conflicts with one that already exists.' },
    });
    return;
  }

  // Anything unrecognised is a bug: log it server-side, tell the client nothing.
  // Leaking a stack trace from a multi-tenant API can reveal another tenant's data.
  console.error('[unhandled]', error);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our end.',
      ...(config.isProduction ? {} : { details: String((error as Error)?.message ?? error) }),
    },
  });
}

/** Wraps an async handler so rejected promises reach the error handler. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => unknown>(
  handler: T,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
