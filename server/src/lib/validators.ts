import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Enter a valid email address.');

/**
 * Long-but-simple beats short-but-cryptic: length is the dominant factor in
 * resistance to offline cracking, so we ask for 10 characters and one number
 * rather than a symbol maze people write on a sticky note.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'That password is too long.')
  .refine((value) => /[a-zA-Z]/.test(value), 'Include at least one letter.')
  .refine((value) => /[0-9]/.test(value), 'Include at least one number.');

export const nameSchema = z.string().trim().min(1, 'Required.').max(120);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens only.');

export const idSchema = z.string().trim().min(3).max(64);

export const moneySchema = z
  .number()
  .int('Use whole cents.')
  .min(0, 'Cannot be negative.')
  .max(100_000_000);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #0F766E');

/**
 * Optional URL field. An empty string (a form input the user cleared) becomes
 * null, while omitting the key entirely leaves the stored value untouched.
 */
export const optionalUrlSchema = z
  .union([
    z.literal(''),
    z.string().trim().max(2048).regex(/^https?:\/\//, 'Enter a URL starting with http:// or https://'),
    z.null(),
  ])
  .optional()
  .transform((value) => (value === '' ? null : value));

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'merchant';
}
