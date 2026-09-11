// Generate the hosted app's roster from the repo, so the prompts and schemas the
// artifact runs are the same ones the product ships rather than a retyped copy.
import { AGENTS } from '../../server/src/island/agents/registry.ts';

const roster = AGENTS.map((a) => ({
  id: a.id, name: a.name, role: a.role, summary: a.summary, stage: a.stage,
  dependsOn: a.dependsOn, core: a.core, enabledByDefault: a.enabledByDefault,
  webSearch: a.webSearch, map: a.map, systemPrompt: a.systemPrompt, schema: a.outputSchema,
}));

const header = `/**
 * The island roster, generated from the product's own registry.
 *
 * Prompts and schemas are not retyped here: they are the same strings the
 * server runs, so the hosted version cannot quietly drift into being a
 * different, friendlier product than the one that was tested.
 */
`;
console.log(header + 'window.ISLAND_AGENTS = ' + JSON.stringify(roster, null, 2) + ';\n');
