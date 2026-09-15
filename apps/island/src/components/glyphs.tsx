/**
 * One line glyph per agent, drawn on a 24×24 grid, stroke-based so it inherits
 * colour and scales cleanly inside a station circle or a card avatar.
 *
 * These replace the emoji that used to stand in for each agent. Every mark is
 * geometric rather than pictorial, because the same path has to survive being
 * drawn at 18 CSS pixels in a roster card and at roughly four map units inside
 * a station — anything with more than about three strokes turns to mud at that
 * size. For the same reason no mark uses more than three subpaths.
 *
 * Every mark is also drawn to fill about sixteen of the twenty-four units it is
 * given. A mark that only filled ten of them read as a smudge in the middle of
 * an otherwise empty card avatar, which is what made the line-icon set look
 * broken rather than quiet.
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
  competitor: `${circle(9.4, 12, 5.9)}${circle(14.6, 12, 5.9)}`,

  // A speech bubble for the customer's own voice.
  customer_research:
    'M7.4 5H16.6A2.4 2.4 0 0 1 19 7.4V13.8A2.4 2.4 0 0 1 16.6 16.2H11' +
    'L7.6 19.4V16.2H7.4A2.4 2.4 0 0 1 5 13.8V7.4A2.4 2.4 0 0 1 7.4 5Z',

  // A chip: die inside a package. Legs were tried and lost at avatar size.
  technology:
    'M8.2 5.6H15.8A2.6 2.6 0 0 1 18.4 8.2V15.8A2.6 2.6 0 0 1 15.8 18.4H8.2' +
    'A2.6 2.6 0 0 1 5.6 15.8V8.2A2.6 2.6 0 0 1 8.2 5.6Z' +
    'M9.8 9.8H14.2V14.2H9.8Z',

  // Balance scales: the beam and its two hanging arms are one stroke, then the
  // stem and the foot.
  legal: 'M4.4 11.0L6.4 6.2H17.6L19.6 11.0M12 6.2V18.6M7.8 18.6H16.2',

  // Three ascending bars.
  market_analysis: 'M5.6 18.8V13.6M12 18.8V9.2M18.4 18.8V5.2',

  // A fork: one input decomposed into two branches.
  analysis: 'M12 19V12L6.2 6.2M12 12L17.8 6.2',

  // A broadcast mark: the source dot and two widening arcs.
  marketing: `${circle(6.6, 12, 1.6)}M11.2 7.6A6.2 6.2 0 0 1 11.2 16.4M14.2 4.8A9.8 9.8 0 0 1 14.2 19.2`,

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
  strategy: 'M6.4 4.4V19.6M6.4 6H18.6L15.4 9.8L18.6 13.6H6.4',

  // A seal: the ring and the check that closes the mission.
  chief_ai: `${circle(12, 12, 7.4)}M8.4 12.2L11 14.8L15.8 9.2`,
};

/** 1.8 on the 24 grid lands at 1.35px once the mark is drawn at 18. The 1.6 the
 *  spec asked for came out at 1.2px, and a 1.2px muted grey line inside a grey
 *  squircle is what made the card avatars read as empty. The map overrides this
 *  from the stylesheet, in map units, so only the card avatars move. */
const STROKE_WIDTH = 1.8;

export interface AgentGlyphProps {
  agent: string;
  /** Side of the square the glyph is drawn into. In a card this is CSS pixels;
   *  on the map it is map units, because a nested SVG measures in whatever its
   *  parent's user space happens to be. The default is the 18px the card
   *  avatar's 36px squircle is specced to hold. */
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
export function AgentGlyph({ agent, size = 18, className }: AgentGlyphProps): JSX.Element {
  const d = AGENT_GLYPHS[agent] ?? FALLBACK_GLYPH;

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
