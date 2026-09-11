import {
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { AgentGlyph } from './glyphs';
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

/** The one agent marked as a capital rather than as a station. */
const HQ_AGENT_ID = 'chief_ai';

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

// The first inland contour, hand-tuned to sit an even distance inside the
// coast. It is the island's one line of relief.
const GRASS = [
  'M11.6 37.6 C10.8 33.9 13.1 27.5 15.0 24.0 C16.8 20.6 20.7 17.0 23.9 15.2',
  'C27.1 13.4 32.1 12.1 35.8 12.1 C39.5 12.1 44.3 15.0 48.1 15.1',
  'C51.8 15.2 56.6 12.4 60.3 12.7 C64.0 13.0 67.8 14.8 72.1 17.1',
  'C76.4 19.4 86.1 23.4 88.4 27.6 C90.8 31.7 88.9 39.7 87.5 44.1',
  'C86.1 48.5 83.0 54.1 79.1 56.4 C75.2 58.6 67.4 59.3 62.3 58.8',
  'C57.1 58.4 50.2 54.1 45.6 53.4 C41.0 52.8 36.1 55.5 32.2 54.7',
  'C28.3 53.9 23.4 51.0 20.2 48.4 C17.0 45.8 12.4 41.4 11.6 37.6 Z',
].join(' ');

/** The middle of the island, and so the point every concentric line on the map
 *  is scaled about. Deriving the contours from the coastline instead of drawing
 *  them by hand keeps them parallel to it and guarantees they never cross. */
const ISLAND_CENTRE = { x: 50, y: 35.6 };

/** One bathymetry ring offshore and one relief contour inland — two lines, and
 *  both close well inside the frame. Anything more stacked up as a set of
 *  concentric wobbles that read as drawn water rather than as depth, and the
 *  outermost of them used to run off the edge and terminate in mid-air. The
 *  scale is small for the same reason: the ring has to stay a suggestion. */
const DEPTH_SCALES = [1.045];
const CONTOUR_SCALES = [1];

/** Station geometry, in map units, and the tightest constraint on this map.
 *
 *  A station's state ring reaches 4.45 units out (r 3.6 plus half of its 0.5
 *  stroke), and under it the second line of its label runs to about 11.2 units
 *  below the centre at phone type, so one station owns a band roughly 15.7 deep
 *  and its own width of label wide. Both frames below are spaced so that no
 *  label meets another label or the ring of the station beneath it — the
 *  tightest clearance in either is about 0.9 units. Raising any number here
 *  eats into that, so it means re-doing the sum in both frames. */
const STATION_R = 3.6;
const HQ_R = 4.8;
const RING_GAP = 0.6;
const HALO_GAP = 1.1;
const FOCUS_GAP = 1.3;
const LABEL_DROP = 3.7;
const LABEL_LEADING = '1.05em';

/** Fallback only: the stylesheet owns the rendered badge radius so it can step
 *  with the label type. One value for every station, capital included — the
 *  capital's badge reports the same state, so it is the same mark. */
const BADGE_R = 0.95;

/** A badge as well as a colour, so the states stay apart for anyone who cannot
 *  tell amber from green. */
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

/** Radii are derived by addition, which is enough to put binary noise into the
 *  rendered attribute. Two places is finer than a map unit ever needs. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

interface Point {
  x: number;
  y: number;
}

/** Scale a shape about the middle of the island without moving it. */
function concentric(centre: Point, scale: number): string {
  return (
    `translate(${n(centre.x)} ${n(centre.y)}) scale(${scale}) ` +
    `translate(${n(-centre.x)} ${n(-centre.y)})`
  );
}

/** Rewrites every coordinate in a path through `move`. Both shapes above are
 *  made of nothing but absolute M, C and Z, so every number in them is half of
 *  a point and the rewrite is a walk over pairs. */
function mapPath(d: string, move: (point: Point) => Point): string {
  const parts: string[] = [];
  let pending: number | null = null;
  for (const token of d.match(/[MCZ]|-?\d*\.?\d+/g) ?? []) {
    if (/[MCZ]/.test(token)) {
      parts.push(token);
      continue;
    }
    const value = Number(token);
    if (pending === null) {
      pending = value;
      continue;
    }
    const moved = move({ x: pending, y: value });
    parts.push(`${n(moved.x)} ${n(moved.y)}`);
    pending = null;
  }
  return parts.join(' ');
}

/* --- The two frames the map is drawn in ----------------------------------- */

/** The habitable strip of the wide viewBox. Registry coordinates are advisory —
 *  an agent placed at the very edge of the 0-100 by 0-70 space still has to
 *  stand on land with its label inside the frame, so every position is mapped
 *  into this box rather than used raw. */
const WIDE_SPAN = { x0: 11, x1: 88, y0: 12, y1: 57 };

function placeWide(agent: IslandAgent, hq: boolean): Point {
  const x = WIDE_SPAN.x0 + (clamp(agent.map.x, 0, 100) / 100) * (WIDE_SPAN.x1 - WIDE_SPAN.x0);
  const y = WIDE_SPAN.y0 + (clamp(agent.map.y, 0, 70) / 70) * (WIDE_SPAN.y1 - WIDE_SPAN.y0);
  // The capital is drawn a third larger than a station, so it needs more room
  // on every side before its ring runs off the frame.
  return hq ? { x: clamp(x, 16, 84), y: clamp(y, 17, 52) } : { x, y };
}

/**
 * The phone frame.
 *
 * A phone gives the map about 360px of width, and the wide frame spends that on
 * six columns of stations: every label lands at six unreadable pixels, the
 * gathering agents' names run into each other and the capital is pressed
 * against the eastern edge. The fix is not smaller type — it is fewer columns.
 *
 * So the whole map turns a quarter clockwise. The registry's six west-to-east
 * columns become six rows and its three north-to-south rows become three
 * columns, which is the same graph with the same trails, read down the screen
 * the way a phone is held rather than across it. Three columns 17.9 units apart
 * and six rows 15.7 apart is what that costs: at 390px the labels come out at
 * 13px, and the tightest pair of them on the map still clears by 3 units.
 *
 * The turn is baked into the coordinates rather than applied as an SVG
 * transform because a transform would rotate the land's drop shadow with it and
 * light the island from the side.
 */
const COMPACT_FRAME_SIZE = { width: 76, height: 104 };
const COMPACT_CENTRE = { x: 38, y: 50.5 };
const COMPACT_SCALE = 1.12;

function toCompact(point: Point): Point {
  return {
    x: COMPACT_CENTRE.x - COMPACT_SCALE * (point.y - ISLAND_CENTRE.y),
    y: COMPACT_CENTRE.y + COMPACT_SCALE * (point.x - ISLAND_CENTRE.x),
  };
}

/** The same advisory box as WIDE_SPAN, with the axes swapped by the turn: the
 *  registry's y runs east across the phone (north to the right, so the mission
 *  still rounds the island the same way) and its x runs down.
 *
 *  It is inset a good deal further than a turned WIDE_SPAN would be, because
 *  the turn scales the land about the frame's centre while the span is measured
 *  off the frame's edges. Spread out to those edges the four stations nearest
 *  the coast — task_manager, customer_research, legal and technology — stood
 *  with their state rings hanging out over the water. Every station now clears
 *  the coastline by at least 0.9 units, which is more margin than the wide
 *  frame gives its own tightest station. */
const COMPACT_SPAN = { x0: 12.5, x1: 62.5, y0: 5, y1: 97 };

function placeCompact(agent: IslandAgent, hq: boolean): Point {
  const x =
    COMPACT_SPAN.x1 - (clamp(agent.map.y, 0, 70) / 70) * (COMPACT_SPAN.x1 - COMPACT_SPAN.x0);
  const y =
    COMPACT_SPAN.y0 + (clamp(agent.map.x, 0, 100) / 100) * (COMPACT_SPAN.y1 - COMPACT_SPAN.y0);
  // The backstop for a registry coordinate this span was not drawn around: hold
  // every station inside the band where two lines of its label still fit above
  // the frame's bottom edge. The capital's ceiling is lower because its label
  // hangs off a larger circle and so starts further down.
  if (hq) return { x: clamp(x, 10, 66), y: clamp(y, 6, 91.5) };
  return { x: clamp(x, 10, 66), y: clamp(y, 6, 92.7) };
}

interface MapFrame {
  width: number;
  height: number;
  centre: Point;
  shore: string;
  grass: string;
  place: (agent: IslandAgent, hq: boolean) => Point;
}

const WIDE_FRAME: MapFrame = {
  width: 100,
  height: 70,
  centre: ISLAND_CENTRE,
  shore: SHORE,
  grass: GRASS,
  place: placeWide,
};

const COMPACT_FRAME: MapFrame = {
  width: COMPACT_FRAME_SIZE.width,
  height: COMPACT_FRAME_SIZE.height,
  centre: COMPACT_CENTRE,
  shore: mapPath(SHORE, toCompact),
  grass: mapPath(GRASS, toCompact),
  place: placeCompact,
};

/** The same width the stylesheet steps the map's label type up at. A viewBox
 *  cannot be swapped from a media query, so the frame has to be chosen here —
 *  but the two have to change together, because the taller type is exactly what
 *  the wide frame has no room for. */
const COMPACT_QUERY = '(max-width: 560px)';

function useCompactFrame(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(COMPACT_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const sync = () => setCompact(query.matches);
    // A resize between first render and this effect would otherwise be missed.
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return compact;
}

/* --- Drawing -------------------------------------------------------------- */

interface Node {
  agent: IslandAgent;
  point: Point;
  hq: boolean;
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

/** Two short lines sit under a station far better than one long one. The full
 *  name is still on the station's own label and tooltip. */
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
  // Gradient and filter ids are document-global, so two maps on one page would
  // otherwise share — and fight over — the same paint.
  const uid = useId().replace(/:/g, '');
  const select = onSelect;
  const frame = useCompactFrame() ? COMPACT_FRAME : WIDE_FRAME;

  const layout = useMemo(() => {
    const nodes: Node[] = agents.map((agent) => {
      const hq = agent.id === HQ_AGENT_ID;
      return { agent, point: frame.place(agent, hq), hq };
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
  }, [agents, frame]);

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

  function renderStation(node: Node) {
    const { agent, point, hq } = node;
    const state = stateOf(states, agent.id);
    const badge = STATE_BADGE[state];
    const r = hq ? HQ_R : STATION_R;
    // The glyph fills 55% of the disc, and the badge straddles the ring on the
    // upper-right diagonal, which is the one quarter no label ever reaches.
    const glyph = round(r * 1.1);
    const badgeAt = round(r * 0.72);
    const label = `${agent.name}, ${STAGE_LABEL[agent.stage]} stage, ${AGENT_STATE_LABEL[state].toLowerCase()}`;

    const classes = ['island-hut', `island-hut--${state}`];
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

        {/* `island-hut--hq` marks the capital in ink, and it is scoped to the
            rings alone: on the whole station it would repaint the state badge
            in ink too, and one finished mission would then show green ticks on
            eight stations and a black one on the ninth. */}
        <g className={hq ? 'island-hut--hq' : undefined}>
          <circle className="island-hut__focus" r={round(r + FOCUS_GAP)} />
          <circle className="island-hut__halo" r={round(r + HALO_GAP)} />
          <circle className="island-hut__pulse" r={round(r + RING_GAP)} />
          <circle className="island-hut__disc" r={r} />
          {/* The ring paints after the disc because the ring is the state, and
              state has to be the thing that survives being overlapped. */}
          <circle className="island-hut__ring" r={round(r + RING_GAP)} />

          {hq ? (
            // A capital is marked with a ring and a filled centre, not with a
            // picture of a building.
            <circle className="island-hut__core" r={1.5} />
          ) : (
            <g transform={`translate(${n(-glyph / 2)} ${n(-glyph / 2)})`}>
              <AgentGlyph agent={agent.id} size={glyph} className="island-hut__glyph" />
            </g>
          )}
        </g>

        {badge ? (
          <g aria-hidden="true">
            <circle className="island-hut__badge-disc" cx={n(badgeAt)} cy={n(-badgeAt)} r={BADGE_R} />
            <text className="island-hut__badge-mark" x={n(badgeAt)} y={n(-badgeAt)}>
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

    const y = point.y + (hq ? HQ_R : STATION_R) + LABEL_DROP;

    return (
      <text key={agent.id} className={classes.join(' ')} x={n(point.x)} y={n(y)}>
        {nameLines(agent.name).map((line, index) => (
          // Leading is set in em so the phone type bump moves the second line
          // with the first instead of crowding it.
          <tspan key={line} x={n(point.x)} dy={index === 0 ? 0 : LABEL_LEADING}>
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
        viewBox={`0 0 ${frame.width} ${frame.height}`}
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
          <radialGradient id={`${uid}-glow`}>
            <stop className="island-map__stop--glow-in" offset="0" />
            <stop className="island-map__stop--glow-out" offset="1" />
          </radialGradient>
          <filter id={`${uid}-lift`} x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow
              className="island-map__lift"
              dx="0"
              dy="1.6"
              stdDeviation="2.6"
              floodColor="#000000"
              floodOpacity="0.12"
            />
          </filter>
        </defs>

        <rect
          className="island-map__sea"
          x="0"
          y="0"
          width={frame.width}
          height={frame.height}
          fill={`url(#${uid}-sea)`}
        />

        {/* Bathymetry: the coastline stepped outwards once, and only far enough
            that the ring still closes inside the frame. One hairline is the
            whole suggestion of water — there is no drawing of a sea here. */}
        <g className="island-map__waves" aria-hidden="true">
          {DEPTH_SCALES.map((scale) => (
            <path
              key={scale}
              className="island-map__wave"
              d={frame.shore}
              transform={concentric(frame.centre, scale)}
            />
          ))}
        </g>

        {/* The shore path exists only to cast the shadow: the land is drawn on
            top of it with the same outline, so its own fill never shows. */}
        <path
          className="island-map__shore"
          d={frame.shore}
          fill={`url(#${uid}-shore)`}
          filter={`url(#${uid}-lift)`}
        />
        <path className="island-map__land" d={frame.shore} fill={`url(#${uid}-land)`} />

        <g className="island-map__contours" aria-hidden="true">
          {CONTOUR_SCALES.map((scale) => (
            <path
              key={scale}
              className="island-map__contour"
              d={frame.grass}
              transform={concentric(frame.centre, scale)}
            />
          ))}
        </g>

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
              <circle className="island-map__packet-halo" r={2.4} fill={`url(#${uid}-glow)`} />
              <circle className="island-map__packet-disc island-map__packet-box" r={1.1} />
            </g>
          </g>
        ) : null}

        <g>{layout.nodes.map(renderStation)}</g>

        {/* Names paint last so a neighbouring station can never bury one. They
            repeat what each station's own label already says. */}
        <g className="island-map__labels" aria-hidden="true">{layout.nodes.map(renderLabel)}</g>
      </svg>

      {/* A changing aria-label on role="img" is not re-announced, so progress
          gets its own polite region. */}
      <p className="sr-only" aria-live="polite">{status}</p>
    </div>
  );
}
