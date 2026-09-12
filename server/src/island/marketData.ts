/**
 * The price feed.
 *
 * The Technical Analysis Agent may not invent a price, which leaves this file
 * exactly two honest outcomes: a complete series that came off the wire, or
 * null. There is deliberately no third state — no partial series, no filled
 * gap, no NaN riding along inside a candle — because a number invented here is
 * a level someone may risk money against.
 *
 * Twelve Data reports failure the way the web-search tool does in
 * provider/claude.ts: HTTP 200 carrying `{status: 'error', message}` where the
 * data would be. So the body decides whether a call worked, not the status
 * code, and nothing here waits for an exception that never comes.
 */
import { islandConfig } from './config';

export interface Candle {
  /** ISO-8601 UTC. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PriceSeries {
  /** As the provider named it, e.g. "EUR/USD". */
  symbol: string;
  interval: string;
  /** Oldest first. */
  candles: Candle[];
  /** Where it came from, for the report's source register. */
  provider: string;
  fetchedAt: string;
}

export interface MarketDataProvider {
  readonly id: string;
  readonly label: string;
  /** Null when this provider cannot serve the symbol at all. */
  fetchSeries(
    symbol: string,
    interval: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<PriceSeries | null>;
}

const TWELVE_DATA_ENDPOINT = 'https://api.twelvedata.com/time_series';

/** Twelve Data's own ceiling on `outputsize`. */
const MAX_CANDLES = 5_000;

/** A feed the orchestrator is waiting on must not be able to hang a mission. */
const REQUEST_TIMEOUT_MS = 15_000;

/** What to wait when a rate limit arrives without a Retry-After to obey. */
const DEFAULT_RETRY_WAIT_MS = 2_000;

/** However long the feed asks for, an agent is not held longer than this. */
const RETRY_WAIT_CAP_MS = 30_000;

// ---------------------------------------------------------------------------
// Pair names as people write them
// ---------------------------------------------------------------------------

/** ISO 4217 codes are three letters; crypto tickers run a little longer. */
const SEPARATED_PAIR = /^([A-Z]{3,5})[\s/\-_.]+([A-Z]{3,5})$/;
const JOINED_PAIR = /^([A-Z]{3})([A-Z]{3})$/;

/**
 * "eurusd", "EUR-USD", "eur/usd", "EUR USD" → "EUR/USD". Null when it is not a
 * pair.
 *
 * A run of letters with no separator is only split when it is exactly six long,
 * because that is the one length two ISO 4217 codes can make. "EURUSDX" gets no
 * reading at all rather than a guessed one — and the pair may well have come
 * out of a model's JSON, so a non-string is refused too.
 */
export function normalisePair(input: string): string | null {
  if (typeof input !== 'string') return null;
  const upper = input.trim().toUpperCase();
  const match = SEPARATED_PAIR.exec(upper) ?? JOINED_PAIR.exec(upper);
  if (!match) return null;

  const [, base, quote] = match;
  // A currency against itself is not a market; refusing it here keeps a typo
  // from being sent to the API as though it were a real request.
  if (!base || !quote || base === quote) return null;
  return `${base}/${quote}`;
}

// ---------------------------------------------------------------------------
// Reading what the feed actually sent
// ---------------------------------------------------------------------------

/** The orchestrator turns the null into a timeline event; this line is for
 *  whoever has to work out why afterwards. It never carries the request URL,
 *  because the API key travels in the query string. */
function warn(message: string): void {
  console.warn(`[island] market data: ${message}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Twelve Data sends prices as strings. `Number('')` and `Number(' ')` are both
 * 0 — exactly the kind of quiet zero that would reach an agent looking like a
 * price — so anything that is not unambiguously a finite number is refused.
 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_AND_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/;

/**
 * Daily bars arrive as "2026-09-11" and intraday ones as "2026-09-11 15:30:00",
 * both already UTC for forex. Those two shapes are stamped as UTC explicitly —
 * left alone, a bare date parses as UTC but a bare date-time parses as server
 * local time, which would silently shift every candle by the host's offset.
 * Anything else goes to Date.parse as-is, and a value it cannot read is fatal
 * to the series rather than rounded into one.
 */
function parseTimestamp(value: unknown): { iso: string; epoch: number } | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  let candidate = raw;
  if (DATE_ONLY.test(raw)) {
    candidate = `${raw}T00:00:00Z`;
  } else {
    const parts = DATE_AND_TIME.exec(raw);
    const date = parts?.[1];
    const hhmm = parts?.[2];
    if (date && hhmm) candidate = `${date}T${hhmm}${parts?.[3] ?? ':00'}Z`;
  }

  const epoch = Date.parse(candidate);
  if (!Number.isFinite(epoch)) return null;
  return { iso: new Date(epoch).toISOString(), epoch };
}

/** Resolves early when the mission is abandoned: a cancelled fetch is a
 *  no-data answer, not an error to throw at the orchestrator. */
function waitOrAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!ms || signal?.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One trip to the API: a body worth reading, a refusal, or a rate limit. */
type Attempt =
  | { kind: 'ok'; body: Record<string, unknown> }
  | { kind: 'failed' }
  | { kind: 'rate_limited'; waitMs: number };

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export class TwelveDataProvider implements MarketDataProvider {
  readonly id = 'twelvedata';
  readonly label = 'Twelve Data';

  constructor(
    private readonly apiKey: string,
    /** Ceiling on the one retry wait. Tests set it to zero so the rate-limit
     *  path runs without a real pause. */
    private readonly maxRetryWaitMs: number = RETRY_WAIT_CAP_MS,
  ) {}

  async fetchSeries(
    symbol: string,
    interval: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<PriceSeries | null> {
    if (signal?.aborted) return null;

    // This adapter serves currency pairs. Something that is not one is not a
    // symbol it can fetch, and saying so beats asking the API to interpret it.
    const pair = normalisePair(symbol);
    if (!pair) return null;

    const wanted = typeof interval === 'string' ? interval.trim() : '';
    if (!wanted) return null;
    if (!Number.isFinite(limit) || limit < 1) return null;

    const url = new URL(TWELVE_DATA_ENDPOINT);
    url.searchParams.set('symbol', pair);
    url.searchParams.set('interval', wanted);
    url.searchParams.set('outputsize', String(Math.min(MAX_CANDLES, Math.floor(limit))));
    url.searchParams.set('format', 'JSON');
    // The key goes in the query string because it is the only credential this
    // API takes; nothing in this file logs the URL.
    url.searchParams.set('apikey', this.apiKey);

    const body = await this.request(url, pair, signal);
    if (!body) return null;
    return this.toSeries(body, pair, wanted);
  }

  /**
   * The whole retry policy: a rate limit earns exactly one wait-and-retry, and
   * nothing else earns any. A refusal repeated is still a refusal, and a feed
   * that is already rationing us is the last thing to hammer.
   */
  private async request(
    url: URL,
    pair: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | null> {
    const first = await this.attempt(url, pair, signal);
    if (first.kind === 'ok') return first.body;
    if (first.kind === 'failed') return null;

    const wait = Math.min(first.waitMs, this.maxRetryWaitMs);
    warn(`${pair}: rate limited, waiting ${Math.round(wait / 1_000)}s for one more try`);
    await waitOrAbort(wait, signal);
    if (signal?.aborted) return null;

    const second = await this.attempt(url, pair, signal);
    if (second.kind === 'ok') return second.body;
    if (second.kind === 'rate_limited') {
      warn(`${pair}: still rate limited after one retry — reporting no prices`);
    }
    return null;
  }

  private async attempt(url: URL, pair: string, signal?: AbortSignal): Promise<Attempt> {
    // The caller's signal and this request's own timeout are merged into one
    // controller so the fetch below only has to care about a single signal.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const forward = (): void => controller.abort();
    signal?.addEventListener('abort', forward, { once: true });

    try {
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
      } catch (error) {
        // A network failure, the timeout above and a mission the user abandoned
        // all land here. None is a price, so none of them throws upward.
        if (!signal?.aborted) warn(`${pair}: the request failed (${describeError(error)})`);
        return { kind: 'failed' };
      }

      const waitMs = retryAfterMs(response.headers);

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        if (response.status === 429) return { kind: 'rate_limited', waitMs };
        if (!signal?.aborted) {
          warn(
            `${pair}: the body could not be read as JSON ` +
              `(HTTP ${response.status}: ${describeError(error)})`,
          );
        }
        return { kind: 'failed' };
      }

      const record = asRecord(body);
      if (!record) {
        warn(`${pair}: the feed sent JSON that is not a response object`);
        return { kind: 'failed' };
      }

      // A refusal arrives as a 200 with status "error" in the body, so the body
      // is checked first and the HTTP code only catches what never got that far.
      if (record['status'] === 'error' || !response.ok) {
        const code = toFiniteNumber(record['code']) ?? response.status;
        if (code === 429) return { kind: 'rate_limited', waitMs };
        const message = textField(record, 'message') ?? `HTTP ${response.status}`;
        warn(`${pair}: the feed refused the request (${code}) — ${message}`);
        return { kind: 'failed' };
      }

      return { kind: 'ok', body: record };
    } finally {
      // Torn down only once the body has been read as well. Cleared any earlier
      // and a response that never finishes streaming would outlive both the
      // timeout and a mission the user has already abandoned.
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    }
  }

  /**
   * Every row or none.
   *
   * A series with one unreadable candle in it is dropped whole. An agent that
   * is told it has no prices behaves correctly; an agent handed a series with a
   * hole in it reads structure across a gap it cannot see.
   */
  private toSeries(
    body: Record<string, unknown>,
    pair: string,
    interval: string,
  ): PriceSeries | null {
    const values = body['values'];
    if (!Array.isArray(values) || values.length === 0) {
      warn(`${pair}: the feed returned no candles`);
      return null;
    }

    const rows: { epoch: number; candle: Candle }[] = [];
    for (const value of values) {
      const row = asRecord(value);
      const time = parseTimestamp(row?.['datetime']);
      const open = toFiniteNumber(row?.['open']);
      const high = toFiniteNumber(row?.['high']);
      const low = toFiniteNumber(row?.['low']);
      const close = toFiniteNumber(row?.['close']);
      if (!time || open === null || high === null || low === null || close === null) {
        warn(`${pair}: a candle would not parse — dropping the whole series rather than a row`);
        return null;
      }
      rows.push({ epoch: time.epoch, candle: { time: time.iso, open, high, low, close } });
    }

    // Twelve Data answers newest first. Sorting rather than reversing means
    // "oldest first" holds whatever order the feed decides to send one day.
    rows.sort((a, b) => a.epoch - b.epoch);

    const meta = asRecord(body['meta']);
    return {
      // The provider's own name for the instrument, so the source register
      // records what was actually queried rather than what we asked for.
      symbol: textField(meta, 'symbol') ?? pair,
      interval: textField(meta, 'interval') ?? interval,
      candles: rows.map((row) => row.candle),
      provider: this.label,
      fetchedAt: new Date().toISOString(),
    };
  }
}

/** Obeys Retry-After when the feed sends one; otherwise a short fixed wait. */
function retryAfterMs(headers: Headers): number {
  const header = headers.get('retry-after');
  const seconds = header ? Number(header) : Number.NaN;
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000;
  return DEFAULT_RETRY_WAIT_MS;
}

// ---------------------------------------------------------------------------
// Which feed this process has, if any
// ---------------------------------------------------------------------------

/** Set by tests; takes precedence over the configuration while it is set. */
let override: MarketDataProvider | null = null;
let configured: MarketDataProvider | null = null;
let warnedAboutProvider = false;

/** The provider configured for this process, or null when none is. */
export function getMarketDataProvider(): MarketDataProvider | null {
  if (override) return override;

  const { provider, apiKey } = islandConfig.marketData;
  // No key is the ordinary state, not a fault. The island runs exactly as it
  // does today and the technical agent reports having no prices.
  if (!apiKey) return null;
  if (configured) return configured;

  if (provider !== 'twelvedata') {
    if (!warnedAboutProvider) {
      warnedAboutProvider = true;
      warn(
        `MARKET_DATA_PROVIDER is "${provider}", which this build has no adapter for — ` +
          'running with no price feed.',
      );
    }
    return null;
  }

  configured = new TwelveDataProvider(apiKey);
  return configured;
}

/**
 * Test seam. Null clears the override and the memoised adapter, so a test that
 * changed the environment gets one built against the new configuration rather
 * than the old one.
 */
export function setMarketDataProvider(provider: MarketDataProvider | null): void {
  override = provider;
  if (!provider) configured = null;
}
