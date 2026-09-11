/**
 * One line glyph per agent, drawn on a 24×24 grid, stroke-based so it inherits
 * colour and scales cleanly inside a station circle or a card avatar.
 *
 * These replace the emoji that used to stand in for each agent. Every mark is
 * geometric rather than pictorial, because the same path has to survive being
 * drawn at 16 CSS pixels in a roster card and at roughly four map units inside
 * a station — anything with more than about three strokes turns to mud at that
 * size. For the same reason no mark uses more than three subpaths.
 */

/** Full circles are two half-arcs rather than one 360° arc, because a single
 *  arc that returns to its own start point is undefined and renderers disagree
 *  about whether to draw anything at all. */
function circle(cx: number, cy: number, r: number): string {
  const left = cx - r;
  const right = cx + r;
  return `M${right} ${cy}A${r} ${r} 0 0 1 ${left} ${cy}A${r} ${r} 0 0 1 ${right} ${cy}Z`;
}

/** Drawn when an agent has no mark of its own — a new specialist appears in the
 *  registry long before anyone draws an icon for it, and a station with nothing
 *  inside reads as a rendering fault rather than as a new agent. */
export const FALLBACK_GLYPH =
  'M8.4 5.4H15.6A3 3 0 0 1 18.6 8.4V15.6A3 3 0 0 1 15.6 18.6H8.4' +
  'A3 3 0 0 1 5.4 15.6V8.4A3 3 0 0 1 8.4 5.4ZM9.2 12H14.8';

export const AGENT_GLYPHS: Record<string, string> = {
  // A compass rose: the ring plus a needle bent at the centre, so it cannot be
  // mistaken for the financial agent's plain diagonal.
  task_manager: `${circle(12, 12, 8.2)}M9 15.2L12 12L15.6 8.6`,

  // A magnifier — lens up and left, handle down and right.
  research: `${circle(10.4, 10.4, 6.2)}M15 15L20.2 20.2`,

  // Two overlapping circles: the competitive overlap, read as a Venn.
  competitor: `${circle(9.2, 12, 5.6)}${circle(14.8, 12, 5.6)}`,

  // A speech bubble for the customer's own voice.
  customer_research:
    'M7.4 5H16.6A2.4 2.4 0 0 1 19 7.4V13.8A2.4 2.4 0 0 1 16.6 16.2H11' +
    'L7.6 19.4V16.2H7.4A2.4 2.4 0 0 1 5 13.8V7.4A2.4 2.4 0 0 1 7.4 5Z',

  // A chip: die inside a package. Legs were tried and lost at 16px.
  technology:
    'M8.8 6.4H15.2A2.4 2.4 0 0 1 17.6 8.8V15.2A2.4 2.4 0 0 1 15.2 17.6H8.8' +
    'A2.4 2.4 0 0 1 6.4 15.2V8.8A2.4 2.4 0 0 1 8.8 6.4Z' +
    'M10.2 10.2H13.8V13.8H10.2Z',

  // Balance scales: the beam and its two hanging arms are one stroke, then the
  // stem and the foot.
  legal: 'M4.6 11.7L6.4 7.7H17.6L19.4 11.7M12 7.7V17.1M8.2 17.1H15.8',

  // Three ascending bars.
  market_analysis: 'M6.6 17.8V13.2M12 17.8V9.6M17.4 17.8V6.2',

  // A fork: one input decomposed into two branches.
  analysis: 'M12 18V12.2L7 7.2M12 12.2L17 7.2',

  // A broadcast mark: the source dot and two widening arcs.
  marketing: `${circle(7.9, 12, 1.5)}M12.1 7.8A6 6 0 0 1 12.1 16.2M14.7 5.2A9.6 9.6 0 0 1 14.7 18.8`,

  // A shield with a check: the verification gate.
  risk_verification:
    'M12 4.4L18.6 6.8V12.2C18.6 16.2 15.6 18.8 12 19.8' +
    'C8.4 18.8 5.4 16.2 5.4 12.2V6.8Z' +
    'M9.2 11.8L11.4 14L15 9.6',

  // A coin: ring with a stem through it, the shape every currency mark shares.
  financial: `${circle(12, 12, 7.4)}M12 6.2V17.8`,

  // A hub: the rotating part of anything that runs day to day.
  operations: `${circle(12, 12, 6.8)}${circle(12, 12, 2.4)}`,

  // A banner on a pole — a position taken, not a cartoon flag.
  strategy: 'M7.4 4.6V19.4M7.4 6H17.6L14.6 9.6L17.6 13.2H7.4',

  // A seal: the ring and the check that closes the mission.
  chief_ai: `${circle(12, 12, 7.4)}M8.4 12.2L11 14.8L15.8 9.2`,
};

export interface AgentGlyphProps {
  agent: string;
  /** Side of the square the glyph is drawn into. In a card this is CSS pixels;
   *  on the map it is map units, because a nested SVG measures in whatever its
   *  parent's user space happens to be. */
  size?: number;
  className?: string;
}

/**
 * Renders one agent's mark.
 *
 * Every stroke property sits on the outer element rather than on the path, and
 * all of them inherit. That is what lets a stylesheet rule on `className`
 * recolour or re-weight the glyph: a presentation attribute on the path itself
 * would beat any rule set on an ancestor, and the mark would be stuck.
 */
export function AgentGlyph({ agent, size = 16, className }: AgentGlyphProps): JSX.Element {
  const d = AGENT_GLYPHS[agent] ?? FALLBACK_GLYPH;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
