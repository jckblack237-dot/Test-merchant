import { describe, expect, it } from 'vitest';
import { AGENTS, CORE_AGENT_IDS, getAgent, planWaves } from '../src/island/agents/registry';
import { CORRECTION_SCHEMA, SCHEMAS_BY_AGENT, SPECIALIST_SCHEMA } from '../src/island/schemas';
import { coerce, describeIssues, normaliseAndValidate, stripUnknown, validate } from '../src/island/validate';
import type { JsonSchema } from '../src/island/types';

/**
 * The schemas are the contract between the orchestrator and fourteen separate
 * model invocations. A schema that is not strict-compatible does not fail
 * loudly — it quietly lets a model return something the next agent then reads
 * as fact, so the shape of every schema is asserted here rather than trusted.
 */
function walk(schema: JsonSchema, path: string, visit: (schema: JsonSchema, path: string) => void): void {
  visit(schema, path);
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    walk(child, path ? `${path}.${key}` : key, visit);
  }
  if (schema.items) walk(schema.items, `${path}[]`, visit);
}

describe('island agent schemas', () => {
  const named = [
    ...Object.entries(SCHEMAS_BY_AGENT),
    ['specialist', SPECIALIST_SCHEMA('legal')] as const,
    ['correction', CORRECTION_SCHEMA('research')] as const,
  ] as [string, JsonSchema][];

  it.each(named)('%s: every object is closed and fully required', (_name, schema) => {
    walk(schema, '', (node, path) => {
      if (node.type !== 'object') return;
      expect(node.additionalProperties, `${path} must set additionalProperties: false`).toBe(false);
      const declared = Object.keys(node.properties ?? {}).sort();
      expect(declared.length, `${path} must declare properties`).toBeGreaterThan(0);
      // Strict structured output has no notion of an optional key: optionality
      // is expressed with an empty string or an empty array instead.
      expect([...(node.required ?? [])].sort(), `${path} must require every property`).toEqual(declared);
    });
  });

  it.each(named)('%s: every named field carries a description for the model', (_name, schema) => {
    walk(schema, '', (node, path) => {
      // Items of a list of plain strings take their meaning from the list's own
      // description; every field a model has to fill in by name needs its own.
      if (!path || path.endsWith('[]')) return;
      const hasGuidance = Boolean(node.description) || node.type === 'object' || node.type === 'array';
      expect(hasGuidance, `${path} needs a description`).toBe(true);
    });
  });

  it('grades confidence on the same 0..1 scale everywhere', () => {
    for (const [, schema] of named) {
      walk(schema, '', (node, path) => {
        if (!/confidence$/.test(path)) return;
        expect(node.type, `${path}`).toBe('number');
        expect(node.minimum, `${path}`).toBe(0);
        expect(node.maximum, `${path}`).toBe(1);
      });
    }
  });
});

describe('schema validation', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      label: { type: 'string', enum: ['a', 'b'] },
      score: { type: 'number', minimum: 0, maximum: 1 },
      count: { type: 'integer', minimum: 0 },
      ok: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'label', 'score', 'count', 'ok', 'tags'],
    additionalProperties: false,
  };

  it('names the exact path of every problem', () => {
    const issues = validate({ name: 7, label: 'c', score: 4, count: 1.5, ok: 'yes', tags: 'x' }, schema);
    const paths = issues.map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'label', 'score', 'count', 'ok', 'tags']));
    expect(describeIssues(issues)).toContain('must be one of: a, b');
  });

  it('reports a missing required field rather than assuming a default', () => {
    const issues = validate({ label: 'a', score: 1, count: 1, ok: true, tags: [] }, schema);
    expect(issues).toEqual([{ path: 'name', message: 'required field is missing' }]);
  });

  it('drops undeclared keys instead of spending a repair round on them', () => {
    const cleaned = stripUnknown({ name: 'x', extra: 'chatter' }, schema) as Record<string, unknown>;
    expect(cleaned).toEqual({ name: 'x' });
  });

  it('re-types what a model got merely cosmetically wrong', () => {
    // None of these invent content: each is the same value written differently.
    expect(coerce('0.8', { type: 'number', minimum: 0, maximum: 1 })).toBe(0.8);
    expect(coerce(85, { type: 'number', minimum: 0, maximum: 1 })).toBeCloseTo(0.85);
    expect(coerce('1,200', { type: 'number' })).toBe(1200);
    expect(coerce(2.6, { type: 'integer' })).toBe(3);
    expect(coerce('true', { type: 'boolean' })).toBe(true);
    expect(coerce('one', { type: 'array', items: { type: 'string' } })).toEqual(['one']);
  });

  it('leaves a confidence already in range alone', () => {
    expect(coerce(0.9, { type: 'number', minimum: 0, maximum: 1 })).toBe(0.9);
    expect(coerce(1, { type: 'number', minimum: 0, maximum: 1 })).toBe(1);
  });

  it('will not coerce a value it cannot honestly re-type', () => {
    const { issues } = normaliseAndValidate({ name: 'x', score: 'high' }, schema);
    expect(issues.some((issue) => issue.path === 'score')).toBe(true);
  });
});

describe('island roster', () => {
  it('gives every agent a prompt, a schema and a map position', () => {
    expect(AGENTS.length).toBeGreaterThanOrEqual(14);
    for (const agent of AGENTS) {
      expect(agent.systemPrompt.length, agent.id).toBeGreaterThan(200);
      expect(agent.outputSchema.type, agent.id).toBe('object');
      expect(agent.map.x, agent.id).toBeGreaterThanOrEqual(0);
      expect(agent.map.x, agent.id).toBeLessThanOrEqual(100);
      expect(agent.map.y, agent.id).toBeGreaterThanOrEqual(0);
      expect(agent.map.y, agent.id).toBeLessThanOrEqual(70);
    }
  });

  it('keeps every dependency inside the roster', () => {
    for (const agent of AGENTS) {
      for (const dependency of agent.dependsOn) {
        expect(getAgent(dependency), `${agent.id} depends on unknown ${dependency}`).toBeDefined();
      }
    }
  });

  it('keeps huts far enough apart for their labels not to collide', () => {
    for (const a of AGENTS) {
      for (const b of AGENTS) {
        if (a.id >= b.id) continue;
        const distance = Math.hypot(a.map.x - b.map.x, a.map.y - b.map.y);
        expect(distance, `${a.id} and ${b.id} overlap on the map`).toBeGreaterThanOrEqual(16);
      }
    }
  });

  it('orders waves so every dependency has already run', () => {
    const waves = planWaves(AGENTS.map((agent) => agent.id));
    const done = new Set<string>();
    for (const wave of waves) {
      for (const id of wave) {
        for (const dependency of getAgent(id)!.dependsOn) {
          expect(done.has(dependency), `${id} ran before ${dependency}`).toBe(true);
        }
      }
      for (const id of wave) done.add(id);
    }
    expect(done.size).toBe(AGENTS.length);
  });

  it('actually runs independent agents together rather than single file', () => {
    const waves = planWaves(AGENTS.map((agent) => agent.id));
    expect(waves.length).toBeLessThan(AGENTS.length);
    expect(waves.some((wave) => wave.length > 1)).toBe(true);
  });

  it('starts with the task manager and ends with the chief', () => {
    const waves = planWaves(CORE_AGENT_IDS);
    expect(waves[0]).toEqual(['task_manager']);
    expect(waves.at(-1)).toEqual(['chief_ai']);
  });

  it('does not strand an agent whose optional dependency was switched off', () => {
    // market_analysis depends on competitor; with competitor disabled it must
    // still run against what research found, not wait forever.
    const enabled = CORE_AGENT_IDS.filter((id) => id !== 'competitor');
    const waves = planWaves(enabled);
    expect(waves.flat().sort()).toEqual([...enabled].sort());
  });

  it('plans a single-agent mission', () => {
    expect(planWaves(['task_manager'])).toEqual([['task_manager']]);
  });

  it('refuses a graph nothing can start in', () => {
    const original = getAgent('research')!.dependsOn;
    getAgent('research')!.dependsOn = ['market_analysis'];
    try {
      expect(() => planWaves(['research', 'market_analysis', 'competitor'])).toThrow(/cycle/i);
    } finally {
      getAgent('research')!.dependsOn = original;
    }
  });
});
