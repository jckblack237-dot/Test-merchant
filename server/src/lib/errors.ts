/** Errors that are safe to surface to an API client verbatim. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'bad_request', message, details);

export const unauthorized = (message = 'Authentication required.') =>
  new ApiError(401, 'unauthorized', message);

export const forbidden = (message = 'You do not have access to this resource.') =>
  new ApiError(403, 'forbidden', message);

/**
 * Used for both "does not exist" and "exists but belongs to another merchant".
 * Returning 404 rather than 403 for the second case is deliberate: a 403 would
 * confirm that an id is real, letting one tenant probe another's id space.
 */
export const notFound = (message = 'Not found.') => new ApiError(404, 'not_found', message);

export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, 'conflict', message, details);

export const paymentRequired = (message: string, details?: unknown) =>
  new ApiError(402, 'subscription_required', message, details);

export const tooManyRequests = (message = 'Too many requests.') =>
  new ApiError(429, 'rate_limited', message);
