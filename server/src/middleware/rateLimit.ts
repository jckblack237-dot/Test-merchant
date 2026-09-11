import rateLimit from 'express-rate-limit';
import { config } from '../config';

const disabled = config.isTest;

/** Generous ceiling for ordinary authenticated API traffic. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: disabled ? 100_000 : 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many requests. Slow down a moment.' } },
});

/** Tight ceiling on credential endpoints to blunt password spraying. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: disabled ? 100_000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' },
  },
});

/** Signup is expensive and abusable; keep it slower still. */
export const signupLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: disabled ? 100_000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: { code: 'rate_limited', message: 'Too many sign-ups from this address. Try again later.' },
  },
});

/**
 * Starting an island mission is the only request in this API that spends money
 * by itself: one mission fans out to a dozen or more model calls. The real
 * budget is `islandConfig.missionsPerDay`, enforced per merchant against the
 * database; this is the cheap first line that stops a loop opening a thousand
 * of them from one address before that count is ever read.
 */
export const missionLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: disabled ? 100_000 : 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many missions started from this address. Try again in a little while.',
    },
  },
});

/** A follow-up question is one more model call against a finished mission. */
export const missionFollowupLimiter = rateLimit({
  windowMs: 60_000,
  limit: disabled ? 100_000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: { code: 'rate_limited', message: 'Too many follow-up questions. Slow down a moment.' },
  },
});
