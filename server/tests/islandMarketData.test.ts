/**
 * The price feed is the only place in the island where a number enters the
 * system from outside, so most of this file is about what it refuses.
 *
 * The invariant every test here shares: `fetchSeries` resolves either null or a
 * complete series in which every price is a finite number that the feed
 * actually sent. There is no third answer. A NaN, a quiet zero from an empty
 * string or a series with a row missing would all reach the Technical Analysis
 * Agent looking exactly like a retrieved price, and it would read structure off
 * them — which is the one failure this product exists to prevent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import {
  getMarketDataProvider,
  normalisePair,
  setMarketDataProvider,
  TwelveDataProvider,
} from '../src/island/marketData';
import type { MarketDataProvider, PriceSeries } from '../src/island/marketData';

const META = {
  symbol: 'EUR/USD',
  interval: '1day',
  currency_base: 'Euro',
  currency_quote: 'US Dollar',
  type: 'Physical Currency',
};

/** Newest first, prices as strings — the shape Twelve Data actually sends. */
const VALUES = [
  { datetime: '2026-09-11', open: '1.17240', high: '1.17550', low: '1.17010', close: '1.17410' },
  { datetime: '2026-09-10', open: '1.16980', high: '1.17330', low: '1.16900', close: '1.17250' },
  { datetime: '2026-09-09', open: '1.17100', high: '1.17200', low: '1.16820', close: '1.16960' },
];

function okBody(values: unknown[] = VALUES): Record<string, unknown> {
  return { meta: META, values, status: 'ok' };
}

/** The first candle with one field replaced by something unusable. */
function rowsWith(patch: Record<string, unknown>): unknown[] {
  return [{ ...VALUES[0], ...patch }, VALUES[1], VALUES[2]];
}

const RATE_LIMITED = {
  code: 429,
  message:
    'You have run out of API credits for the current minute. 9 API credits were used, ' +
    'with the current limit being 8.',
  status: 'error',
};

const UNKNOWN_SYMBOL = {
  code: 404,
  message: '**symbol** not found: EUR/ZZZ. Please specify a valid symbol',
  status: 'error',
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function abortError(): Error {
  const error = new Error('This operation was aborted');
  error.name = 'AbortError';
  return error;
}

let fetchMock: ReturnType<typeof vi.fn>;
let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  setMarketDataProvider(null);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // The adapter is deliberately noisy about failures; the assertions that care
  // read this spy, and the rest of the suite does not need the output.
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  setMarketDataProvider(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Retry wait of zero: the rate-limit path is exercised without a real pause. */
function provider(): MarketDataProvider {
  return new TwelveDataProvider('test-key', 0);
}

/**
 * Every fetch in this file goes through here, so the invariant is asserted on
 * every single response shape the suite covers rather than only where it was
 * remembered.
 */
async function fetchSeries(
  feed: MarketDataProvider,
  symbol = 'EUR/USD',
  interval = '1day',
  limit = 120,
  signal?: AbortSignal,
): Promise<PriceSeries | null> {
  const series = await feed.fetchSeries(symbol, interval, limit, signal);
  if (series === null) return null;

  expect(series.candles.length, 'a series that exists must have candles in it').toBeGreaterThan(0);
  for (const candle of series.candles) {
    for (const [field, value] of Object.entries({
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    })) {
      expect(typeof value, `${field} must be a number`).toBe('number');
      expect(Number.isFinite(value), `${field} must be finite, got ${String(value)}`).toBe(true);
    }
    expect(Number.isNaN(Date.parse(candle.time)), `${candle.time} must be a real instant`).toBe(false);
  }
  return series;
}

function requestedUrl(index = 0): URL {
  const call = fetchMock.mock.calls[index];
  expect(call, `expected a request at index ${index}`).toBeDefined();
  return new URL(String(call?.[0]));
}

// ---------------------------------------------------------------------------

describe('normalisePair', () => {
  const accepted: [string, string][] = [
    ['eurusd', 'EUR/USD'],
    ['EURUSD', 'EUR/USD'],
    ['EUR-USD', 'EUR/USD'],
    ['eur/usd', 'EUR/USD'],
    ['EUR USD', 'EUR/USD'],
    ['eur_usd', 'EUR/USD'],
    ['eur.usd', 'EUR/USD'],
    ['  EUR / USD  ', 'EUR/USD'],
    ['EUR   USD', 'EUR/USD'],
    ['gbpjpy', 'GBP/JPY'],
    // Already normalised input has to survive being normalised again, because
    // the orchestrator normalises before calling and the adapter does it too.
    ['EUR/USD', 'EUR/USD'],
    // Crypto tickers are not three letters, but a separator says where to split
    // without anyone having to guess.
    ['doge/usd', 'DOGE/USD'],
    ['BTC-USD', 'BTC/USD'],
  ];

  it.each(accepted)('reads %s as %s', (input, expected) => {
    expect(normalisePair(input)).toBe(expected);
  });

  const rejected: [string, string][] = [
    ['an empty string', ''],
    ['only whitespace', '   '],
    ['one currency', 'EUR'],
    ['five letters', 'EURUS'],
    // Seven letters has no unambiguous split, and a guessed one ("EURU/SDX")
    // would be a symbol nobody asked for.
    ['seven letters', 'EURUSDX'],
    ['nine letters', 'EURUSDJPY'],
    ['digits in the middle', 'EUR1USD'],
    ['a currency against itself', 'EUREUR'],
    ['a missing quote currency', 'EUR/'],
    ['a missing base currency', '/USD'],
    ['three currencies', 'EUR/USD/JPY'],
    ['a sentence', 'what is the euro doing'],
    ['a side that is too short', 'EU/USD'],
    ['a stray symbol', 'EUR*USD'],
  ];

  it.each(rejected)('refuses %s rather than guessing', (_label, input) => {
    expect(normalisePair(input)).toBeNull();
  });

  it('refuses a value that is not a string at all', () => {
    // The pair can arrive from a model's JSON output, where the type is a hope.
    expect(normalisePair(null as unknown as string)).toBeNull();
    expect(normalisePair(42 as unknown as string)).toBeNull();
    expect(normalisePair({ pair: 'EUR/USD' } as unknown as string)).toBeNull();
  });
});

describe('which feed is configured', () => {
  it('has no provider when no API key is set, and does not treat that as a fault', () => {
    // The test environment sets no MARKET_DATA_API_KEY, which is the state the
    // product ships in: no feed, nothing downstream changes, nothing logged.
    expect(getMarketDataProvider()).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('hands back the override a test installed, and forgets it again', () => {
    const stub: MarketDataProvider = {
      id: 'stub',
      label: 'Stub',
      fetchSeries: async () => null,
    };
    setMarketDataProvider(stub);
    expect(getMarketDataProvider()).toBe(stub);

    setMarketDataProvider(null);
    expect(getMarketDataProvider()).toBeNull();
  });
});

describe('a good response', () => {
  it('parses it into oldest-first candles with numbers as numbers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(okBody()));

    const series = await fetchSeries(provider());

    expect(series).not.toBeNull();
    expect(series?.symbol).toBe('EUR/USD');
    expect(series?.interval).toBe('1day');
    expect(series?.provider).toBe('Twelve Data');
    expect(Number.isNaN(Date.parse(series?.fetchedAt ?? ''))).toBe(false);

    expect(series?.candles.map((candle) => candle.time)).toEqual([
      '2026-09-09T00:00:00.000Z',
      '2026-09-10T00:00:00.000Z',
      '2026-09-11T00:00:00.000Z',
    ]);
    expect(series?.candles[0]).toEqual({
      time: '2026-09-09T00:00:00.000Z',
      open: 1.171,
      high: 1.172,
      low: 1.1682,
      close: 1.1696,
    });
    expect(series?.candles[2]?.close).toBe(1.1741);
  });

  it('asks the right question, with the pair the API expects', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(okBody()));

    await fetchSeries(provider(), 'eurusd', '4h', 200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = requestedUrl();
    expect(url.origin + url.pathname).toBe('https://api.twelvedata.com/time_series');
    expect(url.searchParams.get('symbol')).toBe('EUR/USD');
    expect(url.searchParams.get('interval')).toBe('4h');
    expect(url.searchParams.get('outputsize')).toBe('200');
    expect(url.searchParams.get('apikey')).toBe('test-key');
  });

  it('accepts prices the feed sent as numbers rather than strings', async () => {
    const intraday = {
      datetime: '2026-09-11 15:30:00',
      open: 1.1724,
      high: 1.1755,
      low: 1.1701,
      close: 1.1741,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(okBody([intraday])));

    const series = await fetchSeries(provider());

    // An intraday stamp is UTC at the feed, and must still be UTC here however
    // the host's clock is set.
    expect(series?.candles[0]?.time).toBe('2026-09-11T15:30:00.000Z');
    expect(series?.candles[0]?.open).toBe(1.1724);
  });

  it('sorts into oldest-first even if the feed sends them jumbled', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(okBody([VALUES[1], VALUES[2], VALUES[0]])));

    const series = await fetchSeries(provider());

    expect(series?.candles.map((candle) => candle.time)).toEqual([
      '2026-09-09T00:00:00.000Z',
      '2026-09-10T00:00:00.000Z',
      '2026-09-11T00:00:00.000Z',
    ]);
  });
});

describe('a response that is really a failure', () => {
  it('reads the 200-with-error-body as the failure it is', async () => {
    // The whole reason this adapter branches on the body: the HTTP code says
    // the call worked, and the payload says it did not.
    fetchMock.mockResolvedValueOnce(jsonResponse(UNKNOWN_SYMBOL));

    const series = await fetchSeries(provider(), 'EUR/ZZZ');

    expect(series).toBeNull();
    // An unknown symbol is not a rate limit: asking again changes nothing.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says why, rather than failing silently', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(UNKNOWN_SYMBOL));

    await fetchSeries(provider(), 'EUR/ZZZ');

    const reported = warnSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(reported).toContain('EUR/ZZZ');
    expect(reported).toContain('404');
    // The key travels in the query string, so nothing may log the URL.
    expect(reported).not.toContain('test-key');
  });

  it('never lets a network failure reach the orchestrator', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(fetchSeries(provider())).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('drops a body that is not JSON at all', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 }),
    );

    await expect(fetchSeries(provider())).resolves.toBeNull();
  });

  const malformed: [string, unknown][] = [
    ['a price that is not a number', okBody(rowsWith({ close: 'n/a' }))],
    ['a price that is an empty string', okBody(rowsWith({ open: '' }))],
    ['a price that is whitespace', okBody(rowsWith({ high: '   ' }))],
    ['a price that is null', okBody(rowsWith({ low: null }))],
    ['a missing price field', okBody([{ datetime: '2026-09-11', open: '1.1', high: '1.2', low: '1.0' }])],
    ['a datetime it cannot read', okBody(rowsWith({ datetime: 'last Tuesday' }))],
    ['a datetime that is not a date', okBody(rowsWith({ datetime: '2026-13-45' }))],
    ['a datetime that is missing', okBody(rowsWith({ datetime: null }))],
    ['a row that is a bare string', okBody(['1.17410'])],
    ['no candles at all', okBody([])],
    ['values that is not a list', { meta: META, values: {}, status: 'ok' }],
    ['no values key', { meta: META, status: 'ok' }],
    ['a body that is a list', []],
    ['a body that is a bare string', 'ok'],
    ['an empty body', {}],
  ];

  it.each(malformed)('drops the whole series when the feed sends %s', async (_label, body) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(body));

    // fetchSeries() asserts the no-NaN invariant itself; null is the only other
    // answer available, and a partial series is not.
    await expect(fetchSeries(provider())).resolves.toBeNull();
  });

  it('drops the series for one bad row even when the rest are fine', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(okBody(rowsWith({ close: 'n/a' }))));

    const series = await fetchSeries(provider());

    // Two of the three rows parse perfectly. Handing those over would give the
    // agent a chart with a hole in it that it has no way to see.
    expect(series).toBeNull();
  });
});

describe('a rate limit', () => {
  it('waits once and retries, and takes the answer', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(RATE_LIMITED))
      .mockResolvedValueOnce(jsonResponse(okBody()));

    const series = await fetchSeries(provider());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(series?.candles).toHaveLength(3);
    expect(requestedUrl(1).toString()).toBe(requestedUrl(0).toString());
  });

  it('gives up after that one retry rather than starting a storm', async () => {
    fetchMock.mockResolvedValue(jsonResponse(RATE_LIMITED));

    await expect(fetchSeries(provider())).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats an HTTP 429 with no usable body as a rate limit too', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('Too Many Requests', { status: 429 }))
      .mockResolvedValueOnce(jsonResponse(okBody()));

    const series = await fetchSeries(provider());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(series?.candles).toHaveLength(3);
  });

  it('does not retry anything that is not a rate limit', async () => {
    const invalidKey = { code: 401, message: '**apikey** is invalid', status: 'error' };
    fetchMock.mockResolvedValue(jsonResponse(invalidKey));

    await expect(fetchSeries(provider())).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('an abandoned mission', () => {
  it('does not call out at all when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(fetchSeries(provider(), 'EUR/USD', '1day', 120, controller.signal)).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes the abort through to the request in flight', async () => {
    const controller = new AbortController();
    let inFlight: AbortSignal | undefined;
    fetchMock.mockImplementationOnce(async (_input: unknown, init: { signal?: AbortSignal } = {}) => {
      inFlight = init.signal;
      controller.abort();
      throw abortError();
    });

    const series = await fetchSeries(provider(), 'EUR/USD', '1day', 120, controller.signal);

    expect(series).toBeNull();
    expect(inFlight?.aborted).toBe(true);
    // An abort is the user's decision, not a fault worth reporting.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('stays abortable while the body is still arriving', async () => {
    // The response headers land, then the body stalls. If the abort wiring were
    // torn down when the headers arrived, nothing could end this read and an
    // abandoned mission would wait on a feed forever.
    const controller = new AbortController();
    let bodyStarted = (): void => undefined;
    const reading = new Promise<void>((resolve) => {
      bodyStarted = () => resolve();
    });

    fetchMock.mockImplementationOnce(async (_input: unknown, init: { signal?: AbortSignal } = {}) => {
      const requestSignal = init.signal;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => {
          bodyStarted();
          return new Promise((_resolve, reject) => {
            if (requestSignal?.aborted) {
              reject(abortError());
              return;
            }
            requestSignal?.addEventListener('abort', () => reject(abortError()), { once: true });
          });
        },
      } as unknown as Response;
    });

    const pending = fetchSeries(provider(), 'EUR/USD', '1day', 120, controller.signal);
    await reading;
    controller.abort();

    await expect(pending).resolves.toBeNull();
  });

  it('abandons the rate-limit wait instead of holding the mission open', async () => {
    // A real 30s ceiling, so a test that finishes proves the wait was cut short
    // rather than slept through.
    const feed = new TwelveDataProvider('test-key');
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      controller.abort();
      return jsonResponse(RATE_LIMITED);
    });

    const series = await fetchSeries(feed, 'EUR/USD', '1day', 120, controller.signal);

    expect(series).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('requests the adapter will not make', () => {
  it('refuses a symbol that is not a pair without asking the API', async () => {
    await expect(fetchSeries(provider(), 'not a pair')).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an empty interval or a nonsense candle count', async () => {
    const feed = provider();

    await expect(fetchSeries(feed, 'EUR/USD', '   ')).resolves.toBeNull();
    await expect(fetchSeries(feed, 'EUR/USD', '1day', 0)).resolves.toBeNull();
    await expect(fetchSeries(feed, 'EUR/USD', '1day', Number.NaN)).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never asks for more candles than the feed will serve', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(okBody()));

    await fetchSeries(provider(), 'EUR/USD', '1day', 50_000);

    expect(requestedUrl().searchParams.get('outputsize')).toBe('5000');
  });
});
