import type { Request } from 'express';
import type { ZodTypeAny, z } from 'zod';

/**
 * Parses and strips a request body against a schema. Unknown keys are dropped
 * rather than passed through, so a client cannot smuggle `merchant_id`,
 * `points_balance` or any other column into a write.
 */
export function parseBody<S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> {
  return schema.parse(req.body ?? {}) as z.infer<S>;
}

export function parseQuery<S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> {
  return schema.parse(req.query ?? {}) as z.infer<S>;
}

/**
 * Express 5 types a path parameter as `string | string[]`. Every route in this
 * API declares single-value parameters, so collapse the type at one place
 * rather than casting at each call site.
 */
export function pathParam(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}
