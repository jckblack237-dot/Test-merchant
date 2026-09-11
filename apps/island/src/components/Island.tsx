import { useId, useMemo, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AGENT_STATE_LABEL, STAGE_LABEL, type AgentState, type Stage } from './ui';

/** Just enough of an agent definition to draw it. Anything wider than this is
 *  the roster's business, not the map's. */
export interface IslandAgent {
  id: string;
  name: string;
  emoji: string;
  summary: string;
  stage: Stage;
  map: { x: number; y: number };
  dependsOn: string[];
}

export interface IslandProps {
  agents: IslandAgent[];
  states: Record<string, AgentState>;
  activeTransfer?: { from: string; to: string } | null;
  onSelect?: (agentId: string) => void;
  selected?: string | null;
}

/** The one agent that gets a headquarters rather than a hut. */
const HQ_AGENT_ID = 'chief_ai';

/** The habitable strip of the viewBox. Registry coordinates are advisory — an
 *  agent placed at the very edge of the 0-100 by 0-70 space still has to stand
 *  on land with its label inside the frame, so every position is mapped into
 *  this box rather than used raw. */
const SPAN = { x0: 11, x1: 88, y0: 12, y1: 57 };

// The coastline: a closed spline through fourteen hand-placed headlands, which
// is what stops the island reading as a circle with trees on it.
const SHORE = [
  'M8.0 38.0 C7.2 33.9 9.5 26.8 11.5 23.0 C13.5 19.2 17.6 15.1 21.0 13.0',
  'C24.4 10.9 29.9 9.2 34.0 9.0 C38.1 8.8 43.7 11.4 48.0 11.5',
  'C52.3 11.6 57.9 9.0 62.0 9.5 C66.1 10.0 70.4 12.3 75.0 15.0',
  'C79.6 17.7 89.5 22.4 92.0 27.0 C94.5 31.6 92.5 40.2 91.0 45.0',
  'C89.5 49.8 86.1 55.9 82.0 58.5 C77.9 61.1 69.7 62.2 64.0 62.0',
  'C58.3 61.8 50.2 57.7 45.0 57.0 C39.8 56.3 34.3 58.6 30.0 57.5',
  'C25.7 56.4 20.4 53.0 17.0 50.0 C13.6 47.0 8.8 42.1 8.0 38.0 Z',
].join(' ');

const GRASS = [
  'M11.6 37.6 C10.8 33.9 13.1 27.5 15.0 24.0 C16.8 20.6 20.7 17.0 23.9 15.2',
  'C27.1 13.4 32.1 12.1 35.8 12.1 C39.5 12.1 44.3 15.0 48.1 15.1',
  'C51.8 15.2 56.6 12.4 60.3 12.7 C64.0 13.0 67.8 14.8 72.1 17.1',
  'C76.4 19.4 86.1 23.4 88.4 27.6 C90.8 31.7 88.9 39.7 87.5 44.1',
  'C86.1 48.5 83.0 54.1 79.1 56.4 C75.2 58.6 67.4 59.3 62.3 58.8',
  'C57.1 58.4 50.2 54.1 45.6 53.4 C41.0 52.8 36.1 55.5 32.2 54.7',
  'C28.3 53.9 23.4 51.0 20.2 48.4 C17.0 45.8 12.4 41.4 11.6 37.6 Z',
].join(' ');

/** Two low hills, set in the quarters of the island no agent is placed in. */
const RIDGES = [
  'M17 44 C20.5 39 26 37.5 30.5 39.5 C34.5 41.3 36 44.5 34.5 47 C28 49.5 21 48.5 17 44 Z',
  'M74 21 C77 17 82 16.5 85 19 C87 20.7 87.5 23.5 86 25.5 C81.5 27 76.5 25.5 74 21 Z',
];

/** One swell is 28 units wide, which is exactly how far the stylesheet drifts
 *  it, so the loop never shows a seam. Each line starts off-canvas for the
 *  same reason. */
const SWELL = 'q7 -2.6 14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0';
const WAVES = [5, 19, 51, 66].map((y) => `M-28 ${y} ${SWELL}`);

/** A badge as well as a colour, so the states stay apart for anyone who cannot
 *  tell teal from green. */
const STATE_BADGE: Partial<Record<AgentState, string>> = {
  completed: '✓',
  failed: '!',
  needs_review: '?',
  retrying: '↻',
  blocked: '×',
  skipped: '–',
};

/** The order the label reads states in: what is happening now, then what is
 *  settled, then what is still ahead. */
const SUMMARY_ORDER: AgentState[] = [
  'working',
  'retrying',
  'completed',
  'needs_review',
  'failed',
  'blocked',
  'queued',
  'waiting',
  'skipped',
];

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return (low + high) / 2;
  return Math.min(high, Math.max(low, value));
}

function n(value: number): string {
  return value.toFixed(2);
}

interface Point {
  x: number;
  y: number;
}

interface Node {
  agent: IslandAgent;
  point: Point;
  hq: boolean;
}

function place(agent: IslandAgent, hq: boolean): Point {
  const x = SPAN.x0 + (clamp(agent.map.x, 0, 100) / 100) * (SPAN.x1 - SPAN.x0);
  const y = SPAN.y0 + (clamp(agent.map.y, 0, 70) / 70) * (SPAN.y1 - SPAN.y0);
  // Headquarters is twice the size of a hut and flies a flag, so it needs more
  // room on every side than the huts do.
  return hq ? { x: clamp(x, 16, 84), y: clamp(y, 17, 52) } : { x, y };
}

function trailPath(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  // Bowing every trail the same way round its midpoint keeps two agents that
  // link in both directions from drawing one line twice.
  const bow = Math.min(7, length * 0.16);
  const cx = (from.x + to.x) / 2 - (dy / length) * bow;
  const cy = (from.y + to.y) / 2 + (dx / length) * bow;
  return `M${n(from.x)} ${n(from.y)} Q${n(cx)} ${n(cy)} ${n(to.x)} ${n(to.y)}`;
}

/** Two short lines sit under a hut far better than one long one. The full name
 *  is still on the hut's label and tooltip. */
function nameLines(name: string): string[] {
  const words = name.replace(/\s+agents?$/i, '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > 11) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= 2) return lines;
  return [lines[0] ?? '', `${lines[1] ?? ''}…`];
}

function stateOf(states: Record<string, AgentState>, agentId: string): AgentState {
  return states[agentId] ?? 'waiting';
}

export function Island({ agents, states, activeTransfer, onSelect, selected }: IslandProps) {
  // Gradient ids are document-global, so two maps on one page would otherwise
  // share — and fight over — the same fills.
  const uid = useId().replace(/:/g, '');
  const select = onSelect;

  const layout = useMemo(() => {
    const nodes: Node[] = agents.map((agent) => {
      const hq = agent.id === HQ_AGENT_ID;
      return { agent, point: place(agent, hq), hq };
    });
    const points = new Map<string, Point>(nodes.map((node) => [node.agent.id, node.point]));
    const trails: { key: string; d: string }[] = [];
    for (const node of nodes) {
      for (const dependency of node.agent.dependsOn) {
        const from = points.get(dependency);
        // A dependency the merchant switched off simply has no trail.
        if (!from) continue;
        trails.push({ key: `${dependency}->${node.agent.id}`, d: trailPath(from, node.point) });
      }
    }
    return { nodes, points, trails };
  }, [agents]);

  const transfer = useMemo(() => {
    if (!activeTransfer) return null;
    const from = layout.points.get(activeTransfer.from);
    const to = layout.points.get(activeTransfer.to);
    if (!from || !to) return null;
    return { key: `${activeTransfer.from}->${activeTransfer.to}`, d: trailPath(from, to) };
  }, [activeTransfer, layout]);

  const names = new Map(agents.map((agent) => [agent.id, agent.name]));
  const counts = new Map<AgentState, number>();
  const busy: string[] = [];
  for (const agent of agents) {
    const state = stateOf(states, agent.id);
    counts.set(state, (counts.get(state) ?? 0) + 1);
    if (state === 'working' || state === 'retrying') busy.push(agent.name);
  }

  const done = counts.get('completed') ?? 0;
  const tally = SUMMARY_ORDER.filter((state) => (counts.get(state) ?? 0) > 0)
    .map((state) => `${counts.get(state) ?? 0} ${AGENT_STATE_LABEL[state].toLowerCase()}`)
    .join(', ');
  const handing = activeTransfer
    ? `${names.get(activeTransfer.from) ?? activeTransfer.from} is handing work to ` +
      `${names.get(activeTransfer.to) ?? activeTransfer.to}.`
    : '';

  const mapLabel = agents.length
    ? `Island map of ${agents.length} agents: ${tally}.` +
      `${busy.length ? ` Working now: ${busy.join(', ')}.` : ''}${handing ? ` ${handing}` : ''}`
    : 'Island map. No agents are on this mission.';
  const status = agents.length
    ? `${done} of ${agents.length} agents complete.` +
      `${busy.length ? ` ${busy.join(' and ')} working.` : ''}${handing ? ` ${handing}` : ''}`
    : 'No agents on this mission.';

  function renderHut(node: Node) {
    const { agent, point, hq } = node;
    const state = stateOf(states, agent.id);
    const badge = STATE_BADGE[state];
    const ring = hq ? 9.6 : 6.4;
    const ringY = hq ? -1.8 : -0.7;
    const label = `${agent.name}, ${STAGE_LABEL[agent.stage]} stage, ${AGENT_STATE_LABEL[state].toLowerCase()}`;

    const classes = ['island-hut', `island-hut--${state}`];
    if (hq) classes.push('island-hut--hq');
    if (selected === agent.id) classes.push('is-selected');
    if (select) classes.push('is-interactive');

    return (
      <g
        key={agent.id}
        className={classes.join(' ')}
        data-agent={agent.id}
        data-stage={agent.stage}
        transform={`translate(${n(point.x)} ${n(point.y)})`}
        role={select ? 'button' : 'img'}
        tabIndex={select ? 0 : undefined}
        aria-label={label}
        aria-pressed={select ? selected === agent.id : undefined}
        onClick={select ? () => select(agent.id) : undefined}
        onKeyDown={
          select
            ? (event: ReactKeyboardEvent<SVGGElement>) => {
                if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
                // Space scrolls the page unless we claim it.
                event.preventDefault();
                select(agent.id);
              }
            : undefined
        }
      >
        <title>{`${agent.name} — ${AGENT_STATE_LABEL[state]}. ${agent.summary}`}</title>
        <circle className="island-hut__focus" cy={ringY} r={ring + 2} />
        <circle className="island-hut__halo" cy={ringY} r={ring} />
        <circle className="island-hut__pulse" cy={ringY} r={ring} />
        <circle className="island-hut__ring" cy={ringY} r={ring} />

        {hq ? (
          <>
            <circle className="island-hut__beacon-glow" cy={-13.2} r={2.5} fill={`url(#${uid}-beacon)`} />
            <path className="island-hut__mast" d="M0 -8.6 V-12.9" />
            <path className="island-hut__flag" d="M0.2 -12.7 L5 -11.5 L0.2 -10.3 Z" />
            <circle className="island-hut__beacon" cy={-13.2} r={0.8} />
            <path className="island-hut__roof" d="M-8.4 -3.9 L0 -8.6 L8.4 -3.9 Z" />
            <rect className="island-hut__wall" x={-7} y={-3.9} width={14} height={5.4} rx={0.8} />
            <rect className="island-hut__hq-window" x={-5.8} y={-2.5} width={2} height={1.5} rx={0.3} />
            <rect className="island-hut__hq-window" x={3.8} y={-2.5} width={2} height={1.5} rx={0.3} />
            <text className="island-hut__emoji" y={-1.1}>{agent.emoji}</text>
            <rect className="island-hut__hq-base" x={-8.8} y={1.5} width={17.6} height={3.1} rx={1.1} />
            <text className="island-hut__hq-sign" y={3.1}>COMMAND HQ</text>
          </>
        ) : (
          <>
            <path className="island-hut__roof" d="M-4.9 -0.9 L0 -5.2 L4.9 -0.9 Z" />
            <rect className="island-hut__wall" x={-3.8} y={-0.9} width={7.6} height={4.6} rx={0.6} />
            <path className="island-hut__post" d="M-3.8 3.7 H3.8" />
            <text className="island-hut__emoji" y={1.5}>{agent.emoji}</text>
          </>
        )}

        {badge ? (
          <g aria-hidden="true">
            <circle className="island-hut__badge-disc" cx={ring * 0.72} cy={ringY - ring * 0.72} r={1.7} />
            <text className="island-hut__badge-mark" x={ring * 0.72} y={ringY - ring * 0.72}>
              {badge}
            </text>
          </g>
        ) : null}
      </g>
    );
  }

  function renderLabel(node: Node) {
    const { agent, point, hq } = node;
    const classes = ['island-hut__name'];
    if (hq) classes.push('island-hut__name--hq');
    if (stateOf(states, agent.id) === 'skipped') classes.push('island-hut__name--dim');

    return (
      <text key={agent.id} className={classes.join(' ')} x={n(point.x)} y={n(point.y + (hq ? 10.4 : 8.4))}>
        {nameLines(agent.name).map((line, index) => (
          <tspan key={line} x={n(point.x)} dy={index === 0 ? 0 : 2.9}>
            {line}
          </tspan>
        ))}
      </text>
    );
  }

  return (
    <div className="island-map">
      <svg
        className="island-map__svg"
        viewBox="0 0 100 70"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={mapLabel}
      >
        <defs>
          <linearGradient id={`${uid}-sea`} x1="0" y1="0" x2="0" y2="1">
            <stop className="island-map__stop--sea-top" offset="0" />
            <stop className="island-map__stop--sea-deep" offset="1" />
          </linearGradient>
          <linearGradient id={`${uid}-shore`} x1="0" y1="0" x2="0" y2="1">
            <stop className="island-map__stop--shore-top" offset="0" />
            <stop className="island-map__stop--shore-deep" offset="1" />
          </linearGradient>
          <linearGradient id={`${uid}-land`} x1="0.1" y1="0" x2="0.9" y2="1">
            <stop className="island-map__stop--land-top" offset="0" />
            <stop className="island-map__stop--land-deep" offset="1" />
          </linearGradient>
          <radialGradient id={`${uid}-beacon`}>
            <stop className="island-map__stop--glow-in" offset="0" />
            <stop className="island-map__stop--glow-out" offset="1" />
          </radialGradient>
        </defs>

        <rect x="0" y="0" width="100" height="70" fill={`url(#${uid}-sea)`} />

        <g className="island-map__waves" aria-hidden="true">
          {WAVES.map((d) => (
            <path key={d} className="island-map__wave" d={d} />
          ))}
        </g>

        <path className="island-map__surf" d={SHORE} />
        <path className="island-map__shore" d={SHORE} fill={`url(#${uid}-shore)`} />
        <path className="island-map__land" d={GRASS} fill={`url(#${uid}-land)`} />
        {RIDGES.map((d) => (
          <path key={d} className="island-map__ridge" d={d} />
        ))}

        <g className="island-map__trails" aria-hidden="true">
          {layout.trails.map((trail) => (
            <path
              key={trail.key}
              className={`island-map__trail${transfer?.key === trail.key ? ' island-map__trail--active' : ''}`}
              d={trail.d}
            />
          ))}
        </g>

        {transfer ? (
          <g className="island-map__packet" aria-hidden="true">
            <path className="island-map__packet-trail" d={transfer.d} pathLength={100} />
            <g className="island-map__packet-dot" style={{ offsetPath: `path('${transfer.d}')` }}>
              <circle className="island-map__packet-halo" r={2.6} />
              <rect className="island-map__packet-box" x={-1.5} y={-1.1} width={3} height={2.2} rx={0.4} />
              <path className="island-map__packet-seal" d="M-1.5 -1.1 L0 0.1 L1.5 -1.1" />
            </g>
          </g>
        ) : null}

        <g>{layout.nodes.map(renderHut)}</g>

        {/* Names paint last so a neighbouring hut can never bury one. They
            repeat what each hut's own label already says. */}
        <g className="island-map__labels" aria-hidden="true">{layout.nodes.map(renderLabel)}</g>
      </svg>

      {/* A changing aria-label on role="img" is not re-announced, so progress
          gets its own polite region. */}
      <p className="sr-only" aria-live="polite">{status}</p>
    </div>
  );
}
