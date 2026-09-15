/**
 * The research connectors.
 *
 * This is the first thing in the island that genuinely retrieves a page, which
 * makes it the first thing that can genuinely earn a VERIFIED label — and so
 * the first thing that can hand one out unearned. Every test here is about the
 * boundary between "we have the bytes" and "we do not": a connector that fails
 * must be reported as failed, must carry no content, must not be citable, and
 * must still appear in the record rather than quietly dropping out of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONNECTORS,
  fetchResearchSources,
  formatResearchContext,
  stripMarkup,
  type ResearchSource,
} from '../src/island/research';

const realFetch = globalThis.fetch;

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

describe('stripMarkup', () => {
  it('removes script and style bodies rather than reading them as prose', () => {
    const html = '<style>.a{color:red}</style><p>Arrivals rose 9%</p><script>alert(1)</script>';
    const text = stripMarkup(html);
    expect(text).toBe('Arrivals rose 9%');
    expect(text).not.toContain('color');
    expect(text).not.toContain('alert');
  });

  it('decodes the entities a statistics page actually uses', () => {
    expect(stripMarkup('<td>MVR&nbsp;1,200</td><td>a&amp;b</td>')).toBe('MVR 1,200 a&b');
    expect(stripMarkup('<p>&quot;quoted&quot; &#39;single&#39;</p>')).toBe('"quoted" \'single\'');
    // Seen verbatim on statisticsmaldives.gov.mv the first time it was fetched
    // for real: the site writes its dashes and ampersands as numeric references.
    expect(stripMarkup('Monthly Statistics &#8211; Bureau; Act &#038; Regulation; it&#8217;s &#x41;')).toBe(
      'Monthly Statistics – Bureau; Act & Regulation; it’s A',
    );
    // An entity that was itself escaped is unescaped exactly once.
    expect(stripMarkup('&amp;#39;')).toBe('&#39;');
  });

  it('collapses the whitespace a stripped table leaves behind', () => {
    expect(stripMarkup('<tr>\n  <td>a</td>\n\n  <td>b</td>\n</tr>')).toBe('a b');
  });
});

describe('fetching the connectors', () => {
  beforeEach(() => {
    delete process.env.RESEARCH_CONNECTORS;
    delete process.env.MMA_STATISTICS_API_TOKEN;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('marks a page it actually got as retrieved, with its own timings', async () => {
    globalThis.fetch = vi.fn(async () =>
      htmlResponse('<html><body><h1>Monthly arrivals</h1><p>142,000 in March</p></body></html>'),
    ) as unknown as typeof fetch;

    const sources = await fetchResearchSources();
    const page = sources.find((source) => source.connectorId === 'mv-tourism-dashboard');

    expect(page).toBeDefined();
    expect(page!.status).toBe('retrieved');
    expect(page!.content).toContain('142,000 in March');
    expect(page!.httpStatus).toBe(200);
    expect(page!.payloadBytes).toBeGreaterThan(0);
    expect(typeof page!.responseMs).toBe('number');
  });

  it('refuses to invent a credential, and says where to get one', async () => {
    // The MMA connector names a token env var. Without it there is no request
    // to make — and no pretending the source was consulted.
    const requested: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return htmlResponse('<p>ok</p>');
    }) as unknown as typeof fetch;

    const sources = await fetchResearchSources();
    const api = sources.find((source) => source.connectorId === 'mv-mma-api');

    expect(api!.status).toBe('auth_required');
    expect(api!.content).toBe('');
    expect(api!.note).toContain('MMA_STATISTICS_API_TOKEN');
    expect(api!.note).toContain('https://database.mma.gov.mv/api/register');
    // Not a wasted round trip, and not a 401 in anyone's logs.
    expect(requested).not.toContain('https://database.mma.gov.mv/api');
  });

  it('reports a page it could not get as unavailable, carrying no content', async () => {
    globalThis.fetch = vi.fn(async () => htmlResponse('Service Unavailable', 503)) as unknown as typeof fetch;

    const sources = await fetchResearchSources();
    const failed = sources.filter((source) => source.status === 'unavailable');

    expect(failed.length).toBeGreaterThan(0);
    for (const source of failed) {
      expect(source.content).toBe('');
      expect(source.note).toContain('503');
    }
  });

  it('treats a 200 with nothing readable in it as a miss, not a retrieval', async () => {
    // A login wall or an empty shell answers 200. Calling that "retrieved"
    // would let an agent cite a blank page.
    globalThis.fetch = vi.fn(async () =>
      htmlResponse('<html><head><style>.x{}</style></head><body>   </body></html>'),
    ) as unknown as typeof fetch;

    const sources = await fetchResearchSources();
    const page = sources.find((source) => source.connectorId === 'mv-tourism-dashboard');

    expect(page!.status).toBe('unavailable');
    expect(page!.content).toBe('');
    expect(page!.note).toMatch(/no readable text/i);
  });

  it('turns a thrown request into a reported failure, never a rejection', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ENOTFOUND statisticsmaldives.gov.mv');
    }) as unknown as typeof fetch;

    // One dead network must not take the mission with it.
    const sources = await fetchResearchSources();
    expect(sources).toHaveLength(DEFAULT_CONNECTORS.length);
    const reachable = sources.filter((source) => source.status !== 'auth_required');
    for (const source of reachable) {
      expect(source.status).toBe('unavailable');
      expect(source.note).toContain('ENOTFOUND');
    }
  });

  it('reports every connector it tried, including the ones that failed', async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      return call === 1 ? htmlResponse('<p>arrivals up</p>') : htmlResponse('nope', 500);
    }) as unknown as typeof fetch;

    const sources = await fetchResearchSources();

    // A list that quietly dropped its failures would make a thin mission look
    // fully sourced on a day when three of four sites were down.
    expect(sources).toHaveLength(DEFAULT_CONNECTORS.length);
    expect(sources.map((source) => source.connectorId).sort()).toEqual(
      DEFAULT_CONNECTORS.map((connector) => connector.id).sort(),
    );
  });

  it('falls back to the shipped list when the override is not valid JSON', async () => {
    // islandConfig reads the environment once, at module load, so the override
    // has to be in place before the import — otherwise this test passes without
    // ever reaching the parse it is meant to cover.
    process.env.RESEARCH_CONNECTORS = '{not json';
    globalThis.fetch = vi.fn(async () => htmlResponse('<p>x</p>')) as unknown as typeof fetch;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.resetModules();
    const fresh = await import('../src/island/research');
    const sources = await fresh.fetchResearchSources();

    // A misconfigured deployment gets the shipped connectors and a loud line in
    // the log, rather than silently researching nothing.
    expect(sources).toHaveLength(fresh.DEFAULT_CONNECTORS.length);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('RESEARCH_CONNECTORS'));
  });

  it('uses a valid override instead of the shipped list', async () => {
    process.env.RESEARCH_CONNECTORS = JSON.stringify([
      {
        id: 'custom',
        title: 'Somewhere else entirely',
        url: 'https://example.test/stats',
        sourceType: 'official_release',
        reliability: 'medium',
      },
    ]);
    const asked: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return htmlResponse('<p>local figures</p>');
    }) as unknown as typeof fetch;

    vi.resetModules();
    const fresh = await import('../src/island/research');
    const sources = await fresh.fetchResearchSources();

    expect(sources).toHaveLength(1);
    expect(sources[0]!.connectorId).toBe('custom');
    expect(sources[0]!.status).toBe('retrieved');
    expect(asked).toEqual(['https://example.test/stats']);
  });
});

describe('what the model is shown', () => {
  const retrieved: ResearchSource = {
    connectorId: 'mv-tourism-dashboard',
    title: 'Maldives Ministry of Tourism — Statistics Dashboard',
    url: 'https://www.tourism.gov.mv/en/statistics/dashboard',
    sourceType: 'official_dashboard',
    reliability: 'high',
    status: 'retrieved',
    retrievedAt: '2026-09-14T08:00:00Z',
    content: 'Arrivals for March 2026: 142,000.',
  };

  const blocked: ResearchSource = {
    connectorId: 'mv-mma-api',
    title: 'Maldives Monetary Authority — Statistics API',
    url: 'https://database.mma.gov.mv/api',
    sourceType: 'official_api',
    reliability: 'high',
    status: 'auth_required',
    retrievedAt: '2026-09-14T08:00:00Z',
    content: '',
    note: 'Set MMA_STATISTICS_API_TOKEN to enable this source.',
  };

  it('puts the content of a retrieved page in front of the model', () => {
    const text = formatResearchContext([retrieved]);
    expect(text).toContain('Arrivals for March 2026: 142,000.');
    expect(text).toContain('STATUS: retrieved');
  });

  it('shows the failures too, so a thin base cannot read as a complete one', () => {
    const text = formatResearchContext([retrieved, blocked]);
    expect(text).toContain('1 of 2 connectors returned content');
    expect(text).toContain('STATUS: auth_required');
    expect(text).toContain('MMA_STATISTICS_API_TOKEN');
    // And says plainly that nothing may hang off the one that failed.
    expect(text).toMatch(/nothing here may be attributed to it/i);
  });

  it('tells the model which sources it is allowed to cite', () => {
    expect(formatResearchContext([retrieved, blocked])).toMatch(/cite a source only if its status is "retrieved"/i);
  });

  it('says so plainly when there are no connectors at all', () => {
    expect(formatResearchContext([])).toMatch(/No research connectors are configured/i);
  });
});
