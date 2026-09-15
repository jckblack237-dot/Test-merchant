/**
 * Research connectors — named public sources the island actually retrieves.
 *
 * Until this file existed, the island had exactly one way to learn anything it
 * did not already know: the model's own web-search tool, which needs an API key
 * and which, without one, meant no mission had ever retrieved a single page.
 * Every source in every report was therefore something a model said existed.
 *
 * A connector is the opposite bargain. It names a specific public page up
 * front, fetches it over HTTP, and reports one of exactly three outcomes:
 *
 *   retrieved     — the bytes are here, and here is how long they took
 *   unavailable   — we asked and did not get them, and here is why
 *   auth_required — this source needs a credential this deployment lacks
 *
 * The third is the one worth dwelling on, because it is where most systems
 * quietly lie. A connector that needs a token and has none does NOT fall back
 * to guessing what the source would have said, and does not omit itself from
 * the record so the gap goes unnoticed. It reports auth_required and names the
 * page where a token is obtained. An absent source that says it is absent costs
 * a reader nothing; one that papers over itself costs them the whole report.
 *
 * Only a `retrieved` connector produces content an agent may read, and only a
 * `retrieved` connector is registered as a citable source. That last point is
 * what makes this more than plumbing: report.ts now refuses a VERIFIED label to
 * any claim whose citations are not in the mission's source register, so until
 * something could genuinely be retrieved, VERIFIED was unreachable by
 * construction. This is how a claim earns it.
 */
import { islandConfig } from './config';

export type ResearchStatus = 'retrieved' | 'unavailable' | 'auth_required';

export interface ResearchConnector {
  /** Stable id, used for health history across restarts. */
  id: string;
  title: string;
  url: string;
  sourceType: 'official_dashboard' | 'official_release' | 'official_api' | 'reference';
  /** How much weight the page's origin earns — the publisher's standing, not
   *  the model's opinion of the content. A connector list is curated by hand,
   *  so this is a fact about the deployment, not a guess. */
  reliability: 'high' | 'medium' | 'low';
  /** Environment variable holding this connector's credential. A connector that
   *  names one and cannot find it reports auth_required rather than trying. */
  tokenEnv?: string;
  /** Where a person goes to obtain that credential. Printed in the timeline, so
   *  "this needs auth" is actionable rather than merely true. */
  tokenUrl?: string;
}

export interface ResearchSource {
  connectorId: string;
  title: string;
  url: string;
  sourceType: ResearchConnector['sourceType'];
  reliability: ResearchConnector['reliability'];
  status: ResearchStatus;
  /** ISO-8601. When the attempt happened, not when the page was published. */
  retrievedAt: string;
  /** Text of the page, stripped of markup. Empty unless status is 'retrieved' —
   *  there is no such thing as partial content here. */
  content: string;
  httpStatus?: number;
  responseMs?: number;
  payloadBytes?: number;
  /** Why it failed, or what a person should do about it. */
  note?: string;
}

/**
 * The public sources this deployment is willing to cite.
 *
 * Maldives statistics, because that is the market LoyaltyLoop serves and a
 * merchant asking whether to open a second location needs arrivals and price
 * indices rather than a general-purpose crawl. Override the whole list with
 * RESEARCH_CONNECTORS (JSON) to point a different deployment somewhere else.
 */
export const DEFAULT_CONNECTORS: ResearchConnector[] = [
  {
    id: 'mv-tourism-dashboard',
    title: 'Maldives Ministry of Tourism — Statistics Dashboard',
    url: 'https://www.tourism.gov.mv/en/statistics/dashboard',
    sourceType: 'official_dashboard',
    reliability: 'high',
  },
  {
    id: 'mv-bureau-statistics',
    title: 'Maldives Bureau of Statistics — Monthly Statistics',
    url: 'https://statisticsmaldives.gov.mv/monthly-statistics/',
    sourceType: 'official_release',
    reliability: 'high',
  },
  {
    id: 'mv-mma-monthly',
    title: 'Maldives Monetary Authority — Monthly Statistics Tables',
    url: 'https://database.mma.gov.mv/monthly-statistics',
    sourceType: 'official_release',
    reliability: 'high',
  },
  {
    id: 'mv-mma-api',
    title: 'Maldives Monetary Authority — Statistics API',
    url: 'https://database.mma.gov.mv/api',
    sourceType: 'official_api',
    reliability: 'high',
    tokenEnv: 'MMA_STATISTICS_API_TOKEN',
    tokenUrl: 'https://database.mma.gov.mv/api/register',
  },
];

/** Markup out, text in. Script and style bodies go first, or their contents
 *  arrive as prose and the agent reads CSS as evidence. */
export function stripMarkup(html: string): string {
  return (
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      // Numeric references — a statistics site writes its dashes, apostrophes
      // and ampersands as &#8211; &#8217; &#038; — must be decoded generically,
      // or the model reads "Act &#038; Regulation" as evidence. Found the first
      // time a page was actually retrieved rather than imagined.
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
      // Last, so an escaped entity (&amp;#39;) is unescaped once, not twice.
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function configuredConnectors(): ResearchConnector[] {
  const raw = islandConfig.research.connectors;
  if (!raw) return DEFAULT_CONNECTORS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_CONNECTORS;
    // A malformed override is a deployment mistake worth failing loudly on, but
    // not one worth taking the island down for: fall back and say so.
    return parsed as ResearchConnector[];
  } catch {
    console.warn('[island] RESEARCH_CONNECTORS is not valid JSON; using the default connector list.');
    return DEFAULT_CONNECTORS;
  }
}

async function fetchConnector(
  connector: ResearchConnector,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ResearchSource> {
  const base = {
    connectorId: connector.id,
    title: connector.title,
    url: connector.url,
    sourceType: connector.sourceType,
    reliability: connector.reliability,
    retrievedAt: new Date().toISOString(),
  };

  // Checked before the request, not after a 401: a connector we know we cannot
  // authenticate should not spend a round trip proving it.
  if (connector.tokenEnv && !process.env[connector.tokenEnv]) {
    return {
      ...base,
      status: 'auth_required',
      content: '',
      note:
        `Set ${connector.tokenEnv} to enable this source` +
        (connector.tokenUrl ? `; request a token at ${connector.tokenUrl}.` : '.'),
    };
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(connector.url, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/json',
        'accept-language': 'en',
        'user-agent': 'AI-Agent-Island/1.0 (+public-source-research)',
        ...(connector.tokenEnv
          ? { authorization: `Bearer ${process.env[connector.tokenEnv] as string}` }
          : {}),
      },
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });

    const responseMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        ...base,
        status: 'unavailable',
        content: '',
        httpStatus: response.status,
        responseMs,
        payloadBytes: 0,
        note: `HTTP ${response.status} ${response.statusText}`.trim(),
      };
    }

    const raw = await response.text();
    const content = stripMarkup(raw).slice(0, islandConfig.research.maxChars);

    // A 200 with nothing readable in it is not a retrieval. Saying so here is
    // what stops an agent citing a blank page as a source.
    if (!content) {
      return {
        ...base,
        status: 'unavailable',
        content: '',
        httpStatus: response.status,
        responseMs,
        payloadBytes: Buffer.byteLength(raw, 'utf8'),
        note: 'The response carried no readable text.',
      };
    }

    return {
      ...base,
      status: 'retrieved',
      content,
      httpStatus: response.status,
      responseMs,
      payloadBytes: Buffer.byteLength(raw, 'utf8'),
    };
  } catch (error) {
    return {
      ...base,
      status: 'unavailable',
      content: '',
      responseMs: Date.now() - startedAt,
      payloadBytes: 0,
      note: error instanceof Error ? error.message : 'Request failed',
    };
  }
}

/**
 * Attempts every configured connector, in parallel, and reports all of them.
 *
 * Every connector appears in the result whatever happened to it. A list that
 * quietly omitted its failures would let a mission look fully sourced on a day
 * when three of four sources were down, which is precisely the reading a person
 * would want to avoid making.
 */
export async function fetchResearchSources(signal?: AbortSignal): Promise<ResearchSource[]> {
  const connectors = configuredConnectors();
  if (connectors.length === 0) return [];
  return Promise.all(
    connectors.map((connector) => fetchConnector(connector, islandConfig.research.timeoutMs, signal)),
  );
}

/**
 * The retrieved pages, written for a model to read.
 *
 * Failed connectors are included deliberately, with their reason. An agent told
 * only about what succeeded cannot tell a thin evidence base from a complete
 * one, and will fill the silence — which is the behaviour the whole system is
 * built to prevent.
 */
export function formatResearchContext(sources: ResearchSource[]): string {
  if (sources.length === 0) {
    return 'No research connectors are configured on this server, so nothing was retrieved for this mission.';
  }

  const blocks = sources.map((source) => {
    const head = [
      `SOURCE: ${source.title}`,
      `URL: ${source.url}`,
      `STATUS: ${source.status}`,
      `ATTEMPTED_AT: ${source.retrievedAt}`,
      source.note ? `NOTE: ${source.note}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const body =
      source.status === 'retrieved'
        ? `CONTENT:\n${source.content}`
        : 'CONTENT: none — this source was not retrieved, so nothing here may be attributed to it.';
    return `${head}\n${body}`;
  });

  const retrieved = sources.filter((source) => source.status === 'retrieved').length;
  const header =
    `${retrieved} of ${sources.length} connectors returned content. ` +
    'You may cite a source only if its status is "retrieved". For any source ' +
    'that is not, say the gap exists rather than reasoning as though it were filled.';

  return `${header}\n\n${blocks.join('\n\n---\n\n')}`;
}
