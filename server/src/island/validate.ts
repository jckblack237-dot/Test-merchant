/**
 * A small JSON Schema validator for the dialect used in schemas.ts.
 *
 * Why not a library: the orchestrator does not just need a yes/no. When an
 * agent returns something off-contract it has to be told *precisely* what was
 * wrong so it can repair its own answer (§21 rule 2), and the message has to
 * read well enough for a model to act on. A purpose-built checker over our own
 * small dialect gives better repair prompts than a generic error dump, and adds
 * no dependency to a server that deliberately runs on very few.
 */
import type { JsonSchema, ValidationIssue } from './types';

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function join(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

/**
 * Removes properties the schema does not declare, recursively.
 *
 * A model adding a helpful extra key is not a contract breach worth a retry —
 * it is noise. Dropping it silently keeps the stored output clean while the
 * checks that actually matter (missing fields, wrong types, bad enums) still
 * fail loudly.
 */
export function stripUnknown(value: unknown, schema: JsonSchema): unknown {
  if (schema.type === 'object' && schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(schema.properties)) {
      if (key in source) out[key] = stripUnknown(source[key], child);
    }
    return out;
  }
  if (schema.type === 'array' && schema.items && Array.isArray(value)) {
    return value.map((item) => stripUnknown(item, schema.items!));
  }
  return value;
}

function check(value: unknown, schema: JsonSchema, path: string, issues: ValidationIssue[]): void {
  const actual = typeOf(value);

  switch (schema.type) {
    case 'object': {
      if (actual !== 'object') {
        issues.push({ path, message: `expected an object, received ${actual}` });
        return;
      }
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in record) || record[key] === undefined) {
          issues.push({ path: join(path, key), message: 'required field is missing' });
        }
      }
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (key in record && record[key] !== undefined) {
          check(record[key], child, join(path, key), issues);
        }
      }
      return;
    }

    case 'array': {
      if (actual !== 'array') {
        issues.push({ path, message: `expected an array, received ${actual}` });
        return;
      }
      const list = value as unknown[];
      if (schema.minItems !== undefined && list.length < schema.minItems) {
        issues.push({ path, message: `expected at least ${schema.minItems} item(s), received ${list.length}` });
      }
      if (schema.maxItems !== undefined && list.length > schema.maxItems) {
        issues.push({ path, message: `expected at most ${schema.maxItems} item(s), received ${list.length}` });
      }
      if (schema.items) {
        list.forEach((item, index) => check(item, schema.items!, join(path, index), issues));
      }
      return;
    }

    case 'string': {
      if (actual !== 'string') {
        issues.push({ path, message: `expected a string, received ${actual}` });
        return;
      }
      const text = value as string;
      if (schema.enum && !schema.enum.includes(text)) {
        issues.push({ path, message: `must be one of: ${schema.enum.join(', ')} (received "${text}")` });
      }
      return;
    }

    case 'number':
    case 'integer': {
      if (actual !== 'number' || Number.isNaN(value)) {
        issues.push({ path, message: `expected a number, received ${actual}` });
        return;
      }
      const numeric = value as number;
      if (schema.type === 'integer' && !Number.isInteger(numeric)) {
        issues.push({ path, message: `expected a whole number, received ${numeric}` });
      }
      if (schema.minimum !== undefined && numeric < schema.minimum) {
        issues.push({ path, message: `must be at least ${schema.minimum} (received ${numeric})` });
      }
      if (schema.maximum !== undefined && numeric > schema.maximum) {
        issues.push({ path, message: `must be at most ${schema.maximum} (received ${numeric})` });
      }
      return;
    }

    case 'boolean': {
      if (actual !== 'boolean') {
        issues.push({ path, message: `expected true or false, received ${actual}` });
      }
      return;
    }
  }
}

/** Every way the value fails the schema. Empty array means it is valid. */
export function validate(value: unknown, schema: JsonSchema): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  check(value, schema, '', issues);
  return issues;
}

/** A repair instruction a model can act on, one line per problem. */
export function describeIssues(issues: ValidationIssue[], limit = 25): string {
  return issues
    .slice(0, limit)
    .map((issue) => `- ${issue.path || '(root)'}: ${issue.message}`)
    .join('\n');
}

/**
 * Best-effort coercion of the shapes models most commonly get slightly wrong,
 * applied before validation so a trivially fixable answer does not cost a
 * round trip. Nothing here invents content: it only re-types what is already
 * there (a number written as "0.8", a single string where a list was asked
 * for, a confidence given as 85 instead of 0.85).
 */
export function coerce(value: unknown, schema: JsonSchema): unknown {
  if (schema.type === 'object' && schema.properties) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = { ...source };
    for (const [key, child] of Object.entries(schema.properties)) {
      if (key in source) out[key] = coerce(source[key], child);
    }
    return out;
  }

  if (schema.type === 'array') {
    // A model that had exactly one thing to say sometimes returns it bare.
    const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
    return schema.items ? list.map((item) => coerce(item, schema.items!)) : list;
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    const raw = typeof value === 'string' ? Number(value.replace(/[,\s]/g, '')) : value;
    if (typeof raw !== 'number' || Number.isNaN(raw)) return value;
    let numeric: number = raw;
    // Confidence expressed as a percentage: 85 means 0.85, not "out of range".
    if (schema.maximum === 1 && schema.minimum === 0 && numeric > 1 && numeric <= 100) {
      numeric = numeric / 100;
    }
    if (schema.type === 'integer') numeric = Math.round(numeric);
    return numeric;
  }

  if (schema.type === 'string' && typeof value === 'number') return String(value);

  if (schema.type === 'boolean' && typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
  }

  return value;
}

/** coerce → strip → validate, the order the orchestrator always uses. */
export function normaliseAndValidate(
  value: unknown,
  schema: JsonSchema,
): { value: unknown; issues: ValidationIssue[] } {
  const coerced = coerce(value, schema);
  const stripped = stripUnknown(coerced, schema);
  return { value: stripped, issues: validate(stripped, schema) };
}
