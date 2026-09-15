import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors';
import { merchantPrincipal, requireRole, store } from '../../middleware/auth';
import { parseBody, pathParam } from '../../middleware/validate';
import { badRequest } from '../../lib/errors';
import { islandConfig } from '../../island/config';
import { requireAgent, rosterForMerchant, setAgentEnabled } from '../../island/agents/registry';
import { getProvider } from '../../island/provider';
import { countMissionsToday } from '../../island/store';
import { STAGE_LABEL, type AgentDefinition } from '../../island/types';

export const agentsRouter = Router();

/**
 * The three agents a mission is not honest without.
 *
 * The Task Manager writes the plan every other agent is scheduled from, and the
 * verification gate and the Chief AI are the two independent reviews that stop
 * the island handing back work nobody checked. A merchant may switch off any
 * specialist they are not paying attention to; switching off one of these would
 * quietly turn the product into a single model with extra steps.
 */
export const REQUIRED_AGENT_IDS: readonly string[] = ['task_manager', 'risk_verification', 'chief_ai'];

/**
 * The roster as the API hands it out.
 *
 * The system prompt and the output schema stay on the server: the prompt is the
 * product, the schema is tens of kilobytes per agent, and no client needs
 * either to draw a hut on a map.
 */
export function shapeAgent(
  entry: { definition: AgentDefinition; enabled: boolean },
  options: { selected?: ReadonlySet<string>; includePrompt?: boolean } = {},
) {
  const { definition } = entry;
  return {
    // The definition is product code and identical for every merchant; only
    // `enabled` and `selected` belong to the caller. Keeping them apart is what
    // lets the UI treat the roster as a catalogue with the tenant's choices
    // laid over it, rather than fourteen bags of mixed-provenance fields.
    definition: {
      id: definition.id,
      name: definition.name,
      emoji: definition.emoji,
      role: definition.role,
      summary: definition.summary,
      stage: definition.stage,
      stageLabel: STAGE_LABEL[definition.stage],
      dependsOn: definition.dependsOn,
      core: definition.core,
      enabledByDefault: definition.enabledByDefault,
      webSearch: definition.webSearch,
      required: REQUIRED_AGENT_IDS.includes(definition.id),
      map: definition.map,
      // Sent on the roster page and nowhere else: a merchant is entitled to
      // read the instructions an agent acts on in their name, but fourteen
      // prompts on every mission response would be pure weight.
      ...(options.includePrompt ? { systemPrompt: definition.systemPrompt } : {}),
    },
    enabled: entry.enabled,
    /** Only present when asked about a particular mission: was this agent picked for it? */
    ...(options.selected ? { selected: options.selected.has(definition.id) } : {}),
  };
}

/**
 * Who lives on the island, and what will actually answer when they are asked.
 *
 * The engine block is not decoration. With no credential configured the island
 * still runs end to end, but every word of it comes from the simulation
 * provider, and a client that does not say so on screen is misrepresenting a
 * demonstration as research.
 */
agentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const s = store(req);
    const provider = getProvider();
    res.json({
      agents: rosterForMerchant(s).map((entry) => shapeAgent(entry, { includePrompt: true })),
      engine: provider.kind,
      engineLabel: provider.label,
      simulation: provider.kind === 'simulation',
      islandEnabled: islandConfig.enabled,
      missionsPerDay: islandConfig.missionsPerDay,
      missionsToday: countMissionsToday(s),
    });
  }),
);

const toggleSchema = z.object({ enabled: z.boolean() });

/**
 * Switches one agent on or off for this merchant.
 *
 * Only the override is stored, so a merchant who never opens this page keeps
 * following the product defaults as the roster grows.
 */
agentsRouter.patch(
  '/:agentId',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const { enabled } = parseBody(toggleSchema, req);
    const definition = requireAgent(pathParam(req, 'agentId'));

    if (!enabled && REQUIRED_AGENT_IDS.includes(definition.id)) {
      throw badRequest(
        `The ${definition.name} cannot be switched off. It is one of the three agents every ` +
          'mission needs to plan its work and check its own answers.',
      );
    }

    setAgentEnabled(s, definition.id, enabled);
    s.writeAudit({
      actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
      action: 'island.agent_toggled', entityType: 'island_agent', entityId: definition.id, ip: req.ip,
      meta: { agent: definition.name, enabled },
    });

    res.json({ agent: shapeAgent({ definition, enabled }) });
  }),
);
