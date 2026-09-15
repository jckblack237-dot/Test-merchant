import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db';
import { TenantStore } from '../src/db/tenant';
import { rosterForMerchant, setAgentEnabled, syncAgentRoster } from '../src/island/agents/registry';
import {
  appendEvent,
  countMissionsToday,
  createMission,
  deleteMission,
  findMission,
  getMission,
  listCorrections,
  listEvents,
  listMissions,
  listSources,
  listVerifications,
  nextMissionReference,
  reconcileInterruptedMissions,
  recordCorrection,
  recordSources,
  recordVerifications,
  resolveVerification,
  updateMission,
} from '../src/island/store';
import { subscribe } from '../src/island/events';
import type { MissionEvent, SourceRecord } from '../src/island/types';
import { createMerchant, freshApp, type MerchantFixture } from './helpers';

let app: Express;
let merchant: MerchantFixture;
let store: TenantStore;

beforeEach(async () => {
  app = freshApp();
  merchant = await createMerchant(app);
  store = new TenantStore(merchant.merchantId, getDb());
});

function newMission(task = 'Evaluate a delivery service for the Maldives.') {
  return createMission(store, {
    userTask: task,
    mode: 'auto',
    enabledAgents: ['task_manager', 'research', 'risk_verification', 'chief_ai'],
    createdBy: merchant.ownerId,
    createdByName: 'Test Owner',
  });
}

describe('mission records', () => {
  it('numbers missions per merchant, per year, from one', () => {
    expect(nextMissionReference(store)).toMatch(/^MISSION-\d{4}-001$/);
    const first = newMission();
    const second = newMission();
    expect(first.reference).toMatch(/-001$/);
    expect(second.reference).toMatch(/-002$/);
  });

  it('starts a second merchant at 001 rather than continuing the first', async () => {
    newMission();
    newMission();
    const other = await createMerchant(app);
    const otherStore = new TenantStore(other.merchantId, getDb());
    expect(nextMissionReference(otherStore)).toMatch(/-001$/);
  });

  it('round-trips the fields the engine writes back', () => {
    const mission = newMission();
    const updated = updateMission(store, mission.id, {
      status: 'completed',
      decision: 'proceed_with_caution',
      confidence: 0.62,
      currentStage: 'review',
      error: null,
    });
    expect(updated.status).toBe('completed');
    expect(updated.decision).toBe('proceed_with_caution');
    expect(updated.confidence).toBeCloseTo(0.62);
    expect(getMission(store, mission.id).currentStage).toBe('review');
  });

  it('lists newest first and reports a total independent of the page', () => {
    newMission('one');
    newMission('two');
    newMission('three');
    const page = listMissions(store, { limit: 2, offset: 0 });
    expect(page.missions).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(page.missions[0]!.userTask).toBe('three');
  });

  it('counts only today towards the daily budget', () => {
    newMission();
    expect(countMissionsToday(store)).toBe(1);
  });

  it('deletes a mission and everything hanging off it', () => {
    const mission = newMission();
    appendEvent(store, mission.id, { type: 'mission_created', message: 'created' });
    deleteMission(store, mission.id);
    expect(findMission(store, mission.id)).toBeNull();
    expect(listEvents(store, mission.id)).toHaveLength(0);
  });
});

describe('the mission timeline', () => {
  it('allocates a gapless sequence a reconnecting client can replay from', () => {
    const mission = newMission();
    for (let index = 0; index < 5; index += 1) {
      appendEvent(store, mission.id, { type: 'log', message: `step ${index}` });
    }
    const events = listEvents(store, mission.id);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(listEvents(store, mission.id, 3).map((event) => event.seq)).toEqual([4, 5]);
  });

  it('keeps each mission on its own sequence', () => {
    const a = newMission('a');
    const b = newMission('b');
    appendEvent(store, a.id, { type: 'log', message: 'a1' });
    appendEvent(store, b.id, { type: 'log', message: 'b1' });
    expect(listEvents(store, b.id)[0]!.seq).toBe(1);
  });

  it('publishes only after the event is durable', () => {
    const mission = newMission();
    const seen: MissionEvent[] = [];
    const stop = subscribe(mission.id, (event) => {
      // Replaying at this instant is exactly what a late subscriber does, and
      // it must already find the event it was just told about.
      seen.push(event);
      expect(listEvents(store, mission.id).some((stored) => stored.seq === event.seq)).toBe(true);
    });
    appendEvent(store, mission.id, { type: 'agent_started', agentId: 'research', message: 'off it goes' });
    stop();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.agentId).toBe('research');
  });

  it('stops delivering once unsubscribed', () => {
    const mission = newMission();
    let count = 0;
    const stop = subscribe(mission.id, () => {
      count += 1;
    });
    appendEvent(store, mission.id, { type: 'log', message: 'one' });
    stop();
    appendEvent(store, mission.id, { type: 'log', message: 'two' });
    expect(count).toBe(1);
  });

  it('does not let one broken listener silence the others', () => {
    const mission = newMission();
    let reached = false;
    const stopBad = subscribe(mission.id, () => {
      throw new Error('listener blew up');
    });
    const stopGood = subscribe(mission.id, () => {
      reached = true;
    });
    expect(() => appendEvent(store, mission.id, { type: 'log', message: 'x' })).not.toThrow();
    expect(reached).toBe(true);
    stopBad();
    stopGood();
  });
});

describe('the source register', () => {
  const source = (url: string, title = url): SourceRecord => ({
    source_id: 'S001',
    title,
    url,
    source_type: 'news',
    reliability: 'medium',
  });

  it('gives one page one id for the whole mission', () => {
    const mission = newMission();
    const first = recordSources(store, mission.id, 'run-1', 'research', [
      source('https://example.test/a'),
      source('https://example.test/b'),
    ]);
    expect(first.map((entry) => entry.source_id)).toEqual(['S001', 'S002']);

    const second = recordSources(store, mission.id, 'run-2', 'competitor', [
      source('https://example.test/b'),
      source('https://example.test/c'),
    ]);
    // The page competitor found again keeps research's id, so "S002" means the
    // same page in every agent's citations and in the final report.
    expect(second.map((entry) => entry.source_id)).toEqual(['S002', 'S003']);
    expect(listSources(store, mission.id)).toHaveLength(3);
  });

  it('ignores a repeat inside one agent’s own list', () => {
    const mission = newMission();
    const recorded = recordSources(store, mission.id, 'run-1', 'research', [
      source('https://example.test/a'),
      source('https://example.test/a'),
    ]);
    expect(recorded).toHaveLength(1);
  });

  it('refuses an entry that identifies no page at all', () => {
    const mission = newMission();
    expect(recordSources(store, mission.id, 'run-1', 'research', [source('', '')])).toHaveLength(0);
  });
});

describe('verification and the correction trail', () => {
  it('keeps what a claim said as well as what it says now', () => {
    const mission = newMission();
    recordCorrection(store, mission.id, {
      findingId: 'F002',
      fromAgent: 'competitor',
      toAgent: 'research',
      originalClaim: 'There are no competitors offering this service.',
      correctedClaim: 'Three businesses offer a similar service.',
      reason: 'Found three on a live search.',
      severity: 'high',
      round: 1,
      resolved: true,
    });
    const [entry] = listCorrections(store, mission.id);
    expect(entry!.originalClaim).toContain('no competitors');
    expect(entry!.correctedClaim).toContain('Three businesses');
    expect(entry!.fromAgent).toBe('competitor');
  });

  it('marks a flag settled without losing the reason it was raised', () => {
    const mission = newMission();
    recordVerifications(store, mission.id, 1, [
      {
        findingId: 'F002',
        agentId: 'research',
        status: 'needs_verification',
        reason: 'No source attached.',
        severity: 'high',
        recommendedAction: 'Search for a primary source.',
        correctedValue: '',
        resolved: false,
        round: 1,
      },
    ]);
    resolveVerification(store, mission.id, 'F002', 'Now sourced to S004.');
    const [record] = listVerifications(store, mission.id);
    expect(record!.resolved).toBe(true);
    expect(record!.reason).toBe('No source attached.');
    expect(record!.correctedValue).toBe('Now sourced to S004.');
  });
});

describe('surviving a restart', () => {
  it('never leaves a mission looking alive when nothing is running', () => {
    const mission = newMission();
    updateMission(store, mission.id, { status: 'running' });
    reconcileInterruptedMissions(getDb());

    const after = getMission(store, mission.id);
    expect(after.status).toBe('failed');
    expect(after.error).toMatch(/restart/i);
    expect(listEvents(store, mission.id).at(-1)!.type).toBe('mission_failed');
  });

  it('leaves finished missions alone', () => {
    const mission = newMission();
    updateMission(store, mission.id, { status: 'completed' });
    reconcileInterruptedMissions(getDb());
    expect(getMission(store, mission.id).status).toBe('completed');
  });
});

describe('the per-merchant agent roster', () => {
  it('seeds every agent into the platform roster table', () => {
    syncAgentRoster(getDb());
    const rows = getDb().prepare('SELECT COUNT(*) AS n FROM island_agents WHERE active = 1').get() as {
      n: number;
    };
    expect(rows.n).toBeGreaterThanOrEqual(14);
  });

  it('is safe to run on every boot', () => {
    syncAgentRoster(getDb());
    const before = getDb().prepare('SELECT COUNT(*) AS n FROM island_agents').get() as { n: number };
    syncAgentRoster(getDb());
    const after = getDb().prepare('SELECT COUNT(*) AS n FROM island_agents').get() as { n: number };
    expect(after.n).toBe(before.n);
  });

  it('defaults to the core nine and remembers what a merchant switched on', () => {
    const before = rosterForMerchant(store);
    expect(before.filter((entry) => entry.enabled).map((entry) => entry.definition.id).sort()).toEqual(
      before.filter((entry) => entry.definition.core).map((entry) => entry.definition.id).sort(),
    );

    setAgentEnabled(store, 'legal', true);
    setAgentEnabled(store, 'competitor', false);
    const after = new Map(rosterForMerchant(store).map((entry) => [entry.definition.id, entry.enabled]));
    expect(after.get('legal')).toBe(true);
    expect(after.get('competitor')).toBe(false);
  });

  it('keeps one merchant’s roster out of another’s', async () => {
    setAgentEnabled(store, 'legal', true);
    const other = await createMerchant(app);
    const otherStore = new TenantStore(other.merchantId, getDb());
    const otherRoster = new Map(
      rosterForMerchant(otherStore).map((entry) => [entry.definition.id, entry.enabled]),
    );
    expect(otherRoster.get('legal')).toBe(false);
  });
});
