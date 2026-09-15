/**
 * Turning a mission envelope into the two strings a model actually sees.
 *
 * Both providers render the envelope through here, so there is exactly one
 * place to look when asking "what did this agent actually know when it
 * answered?" — and so a prompt change cannot quietly apply to the live engine
 * but not to the simulation, or the other way round.
 *
 * The rendering is plain Markdown rather than JSON. Models follow a labelled
 * prose brief more reliably than a wall of braces, and a human reading the
 * stored `input` of a run in the audit trail can see at a glance what was
 * asked. The one exception is `previous_outputs`, which stays verbatim JSON:
 * the whole point of a dependency's output is that it arrives unedited.
 */
import type { PriceSeries } from '../marketData';
import { formatResearchContext } from '../research';
import type { AgentDefinition, Finding, Handoff, MissionEnvelope, SourceRecord } from '../types';

/** The house rules, appended to every agent's own prompt. */
const ENVELOPE_RULES = [
  '## How every agent on this island must answer',
  '',
  'You are one agent in a pipeline. Agents ran before you, agents will run after you, and one of',
  'them is paid to find the holes in your work. Write for that reader.',
  '',
  'Label every claim honestly:',
  '- VERIFIED — you retrieved a real source that says this, and you cite it in `evidence`.',
  '- ESTIMATE — you calculated or judged it. Say what it assumes.',
  '- NEEDS_VERIFICATION — a person must confirm it before anyone acts on it.',
  '- HIGH_RISK — it contradicts other work, or being wrong about it would be expensive.',
  '',
  'Confidence is a number you have to defend, not a mood:',
  '- A claim with nothing in `evidence` cannot go above 0.6, however sure you feel.',
  '- You may not raise the confidence on an earlier agent’s finding unless you attach new evidence',
  '  for it. Repeating a claim more confidently is not evidence.',
  '- Never invent a source, a URL, a statistic, a price or a company name. "I could not establish',
  '  this" is a valid answer, and a more useful one than a plausible guess.',
  '',
  'Challenging earlier work is part of the job, not an optional extra. When something upstream is',
  'unsupported, out of date or simply wrong, put it in `issues` with the agent id and the finding id',
  'so the orchestrator can send it back for correction.',
  '',
  'Return your work by calling the submit tool. That call is the only channel that counts — anything',
  'you write as ordinary text is kept as working notes and is not part of your answer. Fill in every',
  'field the schema declares: use "" and [] for the things you genuinely have nothing for, never a',
  'missing key and never a placeholder you made up to look complete.',
].join('\n');

const SEARCH_RULES = [
  '## You have live web search',
  '',
  'Search before you assert. Search again when a result is thin, stale or contradicts another.',
  'Every source you actually opened belongs in your output with the URL you really retrieved — and',
  'nothing you did not open belongs there at all. If the searches come back empty, that is your',
  'finding: report the gap rather than filling it from memory.',
].join('\n');

const CORRECTION_RULES = [
  '## This is a correction round',
  '',
  'The verification agent rejected specific findings in your earlier output. Work through the listed',
  'issues one at a time, by id. Where you can fix a claim, fix it and say what changed and why.',
  'Where you cannot, set `resolved` to false and explain what is blocking it — an honest unresolved',
  'issue is carried into the final report, whereas a correction that only pretends to fix something',
  'poisons everything downstream of it.',
].join('\n');

/**
 * The agent's own prompt plus the rules the orchestrator will actually hold it
 * to. Kept in this order so a specialist prompt sets the voice and the house
 * rules get the last word.
 */
export function buildSystemPrompt(definition: AgentDefinition, envelope: MissionEnvelope): string {
  const parts = [definition.systemPrompt.trim(), ENVELOPE_RULES];
  if (definition.webSearch) parts.push(SEARCH_RULES);
  if (envelope.correction) parts.push(CORRECTION_RULES);
  return parts.join('\n\n');
}

function section(title: string, body: string): string {
  return `## ${title}\n${body}`;
}

function bullets(items: string[], empty: string): string {
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  if (!cleaned.length) return empty;
  return cleaned.map((item) => `- ${item}`).join('\n');
}

/**
 * Guards against a single runaway dependency filling the whole context window.
 * The cap is far above anything the schemas can legitimately produce, so in
 * practice it never fires — and when it does, the agent is told plainly that it
 * is reading a truncated document rather than a complete one.
 */
function clip(text: string, limit = 40_000): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… truncated: this output was too large to pass on in full.`;
}

function renderFinding(finding: Finding): string {
  const support = finding.evidence.length
    ? finding.evidence.map((item) => item.source_id || 'unsourced').join(', ')
    : 'no evidence attached';
  return `- [${finding.finding_id} · ${finding.label} · confidence ${finding.confidence} · ${support}] ${finding.claim}`;
}

function renderSource(source: SourceRecord): string {
  return `- ${source.source_id} | ${source.source_type} | reliability ${source.reliability} | ${source.title} — ${source.url}`;
}

function renderHandoff(handoff: Handoff): string {
  const lines = [`### ${handoff.from_agent} → ${handoff.to_agent}`];
  if (handoff.completed_work.length) {
    lines.push('What it did:', bullets(handoff.completed_work, '- (nothing recorded)'));
  }
  if (handoff.important_findings.length) {
    lines.push('Findings worth your attention:', handoff.important_findings.map(renderFinding).join('\n'));
  }
  if (handoff.questions_to_check.length) {
    lines.push('It asked you to check:', bullets(handoff.questions_to_check, '- (nothing)'));
  }
  if (handoff.warnings.length) {
    lines.push('It warned you about:', bullets(handoff.warnings, '- (nothing)'));
  }
  if (handoff.sources.length) {
    lines.push('Sources it used:', handoff.sources.map(renderSource).join('\n'));
  }
  return lines.join('\n');
}

/**
 * Enough rows that a window far wider than anything configured still arrives
 * whole. It exists only so a misconfigured provider cannot bury the rest of the
 * envelope, and when it fires the agent is told exactly what it is not seeing.
 */
const MAX_CANDLE_ROWS = 400;

const DAILY_TIME = /^(\d{4}-\d{2}-\d{2})T00:00(:00)?(\.0+)?Z?$/;
const MINUTE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:00)?(\.0+)?Z?$/;

/**
 * Shortens a timestamp only where the part being dropped is zero, so 120 daily
 * candles do not spend a third of their width on "T00:00:00.000Z" each. A
 * timestamp with anything in it is printed exactly as it arrived.
 */
function compactTime(time: string): string {
  const daily = DAILY_TIME.exec(time);
  if (daily?.[1]) return daily[1];
  const minute = MINUTE_TIME.exec(time);
  if (minute?.[1] && minute[2]) return `${minute[1]} ${minute[2]}`;
  return time;
}

/**
 * The candles, as a CSV table.
 *
 * Every candle that was fetched is listed: a window with holes in it produces
 * levels nobody can check, and an agent asked to find support has to see the
 * lows that formed it. Prices are printed exactly as the provider sent them —
 * rounding a price on the way to an agent that may not invent one would be
 * inventing one on its behalf.
 */
function renderMarketData(series: PriceSeries): string {
  const rows = series.candles.map(
    (candle) =>
      `${compactTime(candle.time)},${candle.open},${candle.high},${candle.low},${candle.close}`,
  );
  const shown = rows.length > MAX_CANDLE_ROWS ? rows.slice(-MAX_CANDLE_ROWS) : rows;
  const omitted = rows.length - shown.length;

  const latest = series.candles[series.candles.length - 1];
  const lines = [
    `- Symbol: ${series.symbol}`,
    `- Interval: ${series.interval}`,
    `- Provider: ${series.provider}`,
    `- Retrieved at: ${series.fetchedAt}`,
    `- ${series.candles.length} candles, oldest first` +
      (latest ? `, most recent close ${latest.close} at ${latest.time}` : ''),
    '',
    'This table is the whole of the price data you have. Every level you give, and every number you',
    'write that is a price, must be one you can point at in these rows. Anything you cannot read off',
    'them is unknown, and "unknown" is the answer. Prices are exactly as the feed sent them.',
    '',
    '```csv',
    'time,open,high,low,close',
    ...shown,
    '```',
  ];

  if (omitted > 0) {
    lines.push(
      '',
      `The ${omitted} oldest candles of this window are not shown here. You do not have them: do not ` +
        'reason about the period they cover, and say so if the question needed it.',
    );
  }

  return lines.join('\n');
}

/** What an agent that asked for prices is told when there are none. The reason
 *  is in the mission timeline; what matters here is that it never reads as an
 *  invitation to supply the numbers itself. */
const NO_RESEARCH = [
  'Nothing was retrieved for this mission. No page was opened on your behalf, and there are no',
  'sources in this envelope.',
  '',
  'This is a normal state, not a fault: the connectors are optional and a fetch can fail. Say so.',
  'Everything you write is therefore from your own prior knowledge, which means none of it is',
  'VERIFIED and none of it may cite a source. Name the gaps a person would have to close, rather',
  'than closing them yourself with something that sounds right.',
].join('\n');

const NO_MARKET_DATA = [
  'No price data reached this mission, so there are no prices in this envelope at all.',
  '',
  'This is the ordinary case, not a fault: the feed is optional, most missions name no pair, and a',
  'fetch can fail. Report it as it is — no live prices, no levels, and every price field unknown.',
  'Do not supply a number from memory or from an earlier agent to fill the gap: a price nobody',
  'retrieved is one nobody can check, and someone may risk money against it.',
].join('\n');

/**
 * The user turn: everything this agent is allowed to know about the mission.
 *
 * Dependencies arrive in full because an agent that only sees a summary of the
 * work it is meant to build on ends up re-deriving it, badly. Everything else
 * arrives trimmed.
 */
export function buildUserMessage(definition: AgentDefinition, envelope: MissionEnvelope): string {
  const blocks: string[] = [`# Mission ${envelope.mission_reference}`];

  blocks.push(section('The task, in the user’s own words', envelope.original_task.trim()));

  if (envelope.objective.trim()) {
    blocks.push(section('Objective', envelope.objective.trim()));
  }

  if (envelope.user_requirements.length) {
    blocks.push(section('What the user explicitly asked for', bullets(envelope.user_requirements, '')));
  }

  blocks.push(
    section('Constraints', bullets(envelope.constraints, '- None were given. Say so if that matters.')),
  );

  blocks.push(
    section(
      'Where this is happening',
      [
        `- Geography: ${envelope.geography || 'not specified'}`,
        `- Language: ${envelope.language || 'not specified'}`,
        `- Currency: ${envelope.currency || 'not specified'} — quote every money figure in this currency.`,
      ].join('\n'),
    ),
  );

  blocks.push(
    section(
      'Where you are in the pipeline',
      [
        `- Stage: ${envelope.current_stage}`,
        `- Agent that ran immediately before you: ${envelope.previous_agent ?? 'none — you are first'}`,
        `- You are: ${definition.name} (${definition.id}) — ${definition.role}`,
      ].join('\n'),
    ),
  );

  const market = envelope.market_data;
  if (market) {
    blocks.push(section('Live price data', renderMarketData(market)));
  } else if (definition.needsMarketData) {
    blocks.push(section('Live price data', NO_MARKET_DATA));
  }

  const research = envelope.research_sources;
  if (research?.length) {
    blocks.push(section('Pages retrieved for you', formatResearchContext(research)));
  } else if (definition.needsResearch) {
    blocks.push(section('Pages retrieved for you', NO_RESEARCH));
  }

  if (envelope.research_questions.length) {
    blocks.push(
      section(
        'Questions this mission has to answer',
        envelope.research_questions
          .map((item) => `- [${item.question_id} · ${item.priority} priority] ${item.question}`)
          .join('\n'),
      ),
    );
  }

  if (envelope.previous_outputs.length) {
    const rendered = envelope.previous_outputs
      .map((output) => {
        const agent = typeof output.agent === 'string' ? output.agent : 'unknown agent';
        return `### ${agent} — complete output\n\`\`\`json\n${clip(JSON.stringify(output, null, 2))}\n\`\`\``;
      })
      .join('\n\n');
    blocks.push(section('The agents you depend on, in full', rendered));
  }

  if (envelope.handoffs.length) {
    blocks.push(
      section('Hand-offs from everyone who has run so far', envelope.handoffs.map(renderHandoff).join('\n\n')),
    );
  }

  blocks.push(
    section(
      'Source register',
      envelope.available_sources.length
        ? [
            'Cite these by `source_id` in your `evidence`. Do not cite an id that is not on this list.',
            envelope.available_sources.map(renderSource).join('\n'),
          ].join('\n')
        : 'Empty — nothing has been retrieved on this mission yet.',
    ),
  );

  const correction = envelope.correction;
  if (correction) {
    blocks.push(
      section(
        `CORRECTION REQUIRED — attempt ${correction.retry_number} of ${correction.maximum_retries}`,
        [
          'Your previous output did not survive verification. Fix exactly these findings, nothing else.',
          '',
          correction.issues
            .map((issue) =>
              [
                `- ${issue.issue_id} · finding ${issue.finding_id || '(general)'} · severity ${issue.severity}`,
                `  Problem: ${issue.problem}`,
                `  Required action: ${issue.required_action}`,
              ].join('\n'),
            )
            .join('\n'),
          '',
          'Return one entry in `corrections` for every issue above, using the same finding ids. If an',
          'issue cannot be resolved, say so with `resolved: false` and explain what is missing.',
        ].join('\n'),
      ),
    );
  }

  if (envelope.instructions.trim()) {
    blocks.push(section('Specific instructions for you on this mission', envelope.instructions.trim()));
  }

  blocks.push(
    section(
      'Now do your part',
      correction
        ? `Work through the correction list above, then call submit_${definition.id}_report to return it.`
        : `Do the work this mission needs from ${definition.name}, then call submit_${definition.id}_report to return it. That call is your answer.`,
    ),
  );

  return blocks.join('\n\n');
}
