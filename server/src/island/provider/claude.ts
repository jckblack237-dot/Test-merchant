/**
 * The live engine: one real model invocation per agent.
 *
 * Two things about this file are load-bearing and easy to get wrong.
 *
 * First, structured output here is a **forced custom tool call**. The pinned
 * SDK has no response-format parameter, so the agent's JSON Schema is sent as a
 * tool's `input_schema` and `tool_choice` makes calling it mandatory. What
 * comes back in `block.input` is already-parsed JSON; nothing in this file ever
 * parses model prose looking for a report.
 *
 * Second, a web search that fails does **not** throw. It arrives as a normal
 * 200 response carrying an error object where the result list would be, so the
 * only way to tell success from failure is the shape of `content`.
 */
import Anthropic, {
  APIConnectionError,
  APIUserAbortError,
  BadRequestError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { islandConfig } from '../config';
import { CORRECTION_SCHEMA } from '../schemas';
import type {
  AgentDefinition,
  AgentInvocation,
  AgentInvocationResult,
  AgentOutput,
  AgentProvider,
  JsonSchema,
  MissionEnvelope,
  Reliability,
  SourceRecord,
  SourceType,
} from '../types';
import { AgentFailure } from '../types';
import { describeIssues, normaliseAndValidate } from '../validate';
import { buildSystemPrompt, buildUserMessage } from './envelope';

const MAX_OUTPUT_TOKENS = 16_000;

/** The API ends a `pause_turn` chain itself; this only stops a bug looping forever. */
const MAX_RESEARCH_TURNS = 12;

/** Narration is kept for the audit trail, not for reading end to end. */
const MAX_NOTES_CHARS = 12_000;

/** However long a rate limit asks us to wait, the agent timeout is the real ceiling. */
const RETRY_AFTER_CAP_MS = 30_000;

interface Tally {
  inputTokens: number;
  outputTokens: number;
  notes: string[];
  sources: SourceRecord[];
  seenUrls: Set<string>;
}

/** A wait that an aborted mission can interrupt, rather than one it has to outlive. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new APIUserAbortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new APIUserAbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function retryAfterMs(error: RateLimitError): number {
  const header = error.headers?.get('retry-after');
  const seconds = header ? Number(header) : Number.NaN;
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1_000, RETRY_AFTER_CAP_MS);
  return 2_000;
}

/**
 * Web search hands back a title and a URL and nothing else, so grading a source
 * any more finely than this would be the provider inventing metadata. Only the
 * unambiguous signals in a hostname are used; anything else stays deliberately
 * neutral until an agent that actually read the page grades it in its own
 * `sources` list.
 */
function classify(url: string): { source_type: SourceType; reliability: Reliability } {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { source_type: 'other', reliability: 'medium' };
  }
  if (host.endsWith('.gov') || host.includes('.gov.') || host.endsWith('.europa.eu')) {
    return { source_type: 'official', reliability: 'high' };
  }
  if (host.endsWith('.edu') || host.includes('.ac.')) {
    return { source_type: 'research', reliability: 'high' };
  }
  return { source_type: 'other', reliability: 'medium' };
}

/** What to tell the user this agent is off looking for, in their own words. */
function researchTopic(definition: AgentDefinition, envelope: MissionEnvelope): string {
  const top =
    envelope.research_questions.find((question) => question.priority === 'high') ??
    envelope.research_questions[0];
  const text = top ? top.question : definition.summary;
  return text.replace(/[?.\s]+$/, '').toLowerCase();
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export class ClaudeProvider implements AgentProvider {
  readonly kind = 'claude' as const;
  readonly label = `Claude (${islandConfig.model})`;

  private client: Anthropic | null = null;

  /** Built lazily so importing this module without a key configured is harmless. */
  private sdk(): Anthropic {
    if (!this.client) {
      const apiKey = islandConfig.apiKey;
      if (!apiKey) {
        throw new Error('No ANTHROPIC_API_KEY is configured, so the Claude engine cannot run.');
      }
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  async run(invocation: AgentInvocation): Promise<AgentInvocationResult> {
    const { definition, envelope, onProgress } = invocation;
    const schema = envelope.correction ? CORRECTION_SCHEMA(definition.id) : definition.outputSchema;

    // The mission's own signal and the per-agent timeout are merged into one
    // controller so every SDK call downstream only has to care about one.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, islandConfig.agentTimeoutMs);
    const forwardAbort = (): void => controller.abort();
    invocation.signal?.addEventListener('abort', forwardAbort, { once: true });
    if (invocation.signal?.aborted) controller.abort();

    try {
      return await this.execute(definition, envelope, schema, controller.signal, onProgress);
    } catch (error) {
      throw this.translate(definition, error, timedOut);
    } finally {
      clearTimeout(timer);
      invocation.signal?.removeEventListener('abort', forwardAbort);
    }
  }

  /**
   * Both the timeout and a paused mission surface as the same SDK abort error,
   * so they are told apart by which one fired. A timeout is this agent's own
   * failure and the mission goes on without it; an abort came from the user and
   * must travel back up untouched so the orchestrator does not mistake it for a
   * bad agent.
   */
  private translate(definition: AgentDefinition, error: unknown, timedOut: boolean): unknown {
    if (error instanceof AgentFailure) return error;
    if (error instanceof APIUserAbortError) {
      if (!timedOut) return error;
      const seconds = Math.round(islandConfig.agentTimeoutMs / 1_000);
      return new AgentFailure(definition.id, `${definition.name} ran past the ${seconds}s agent timeout.`);
    }
    if (error instanceof BadRequestError) {
      return new AgentFailure(
        definition.id,
        `The API rejected the request for ${definition.name}: ${error.message}`,
      );
    }
    if (error instanceof Error) {
      return new AgentFailure(definition.id, `${definition.name} could not complete: ${error.message}`);
    }
    return new AgentFailure(definition.id, `${definition.name} could not complete.`);
  }

  private async execute(
    definition: AgentDefinition,
    envelope: MissionEnvelope,
    schema: JsonSchema,
    signal: AbortSignal,
    onProgress?: (note: string) => void,
  ): Promise<AgentInvocationResult> {
    const system = buildSystemPrompt(definition, envelope);
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: buildUserMessage(definition, envelope) },
    ];
    const tally: Tally = {
      inputTokens: 0,
      outputTokens: 0,
      notes: [],
      sources: [],
      seenUrls: new Set<string>(),
    };

    if (envelope.correction) {
      onProgress?.(`working through ${plural(envelope.correction.issues.length, 'correction')}`);
    }

    if (definition.webSearch) {
      await this.research(definition, envelope, system, messages, tally, signal, onProgress);
      messages.push({
        role: 'user',
        content:
          'That is enough research. Turn what you actually found into your report and call ' +
          `submit_${definition.id}_report. Cite only pages you opened; where you found nothing, ` +
          'say so rather than filling the gap.',
      });
    } else if (!envelope.correction) {
      onProgress?.(`working through the ${definition.name.toLowerCase()} brief`);
    }

    const { output, repairs } = await this.shape(
      definition,
      schema,
      system,
      messages,
      tally,
      signal,
      Boolean(envelope.correction),
      onProgress,
    );

    return {
      output,
      sources: tally.sources,
      notes: tally.notes.join('\n\n').slice(0, MAX_NOTES_CHARS),
      inputTokens: tally.inputTokens,
      outputTokens: tally.outputTokens,
      repairs,
    };
  }

  /**
   * Phase one for research-shaped agents: let the model search freely, with no
   * forced tool, and keep handing the turn back for as long as the server says
   * it paused mid-thought.
   */
  private async research(
    definition: AgentDefinition,
    envelope: MissionEnvelope,
    system: string,
    messages: Anthropic.MessageParam[],
    tally: Tally,
    signal: AbortSignal,
    onProgress?: (note: string) => void,
  ): Promise<void> {
    const searchTool: Anthropic.WebSearchTool20250305 = {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: islandConfig.maxWebSearches,
    };

    onProgress?.(`searching the web for ${researchTopic(definition, envelope)}`);

    for (let turn = 0; turn < MAX_RESEARCH_TURNS; turn += 1) {
      const message = await this.call(
        {
          model: islandConfig.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system,
          messages,
          tools: [searchTool],
        },
        signal,
        onProgress,
      );
      tally.inputTokens += message.usage.input_tokens;
      tally.outputTokens += message.usage.output_tokens;
      this.harvest(message, tally, onProgress);
      messages.push({ role: 'assistant', content: message.content });

      // pause_turn means the server hit its own tool-iteration limit part way
      // through; the documented way to continue is to hand the same turn back.
      if (message.stop_reason !== 'pause_turn') break;
    }

    onProgress?.(
      tally.sources.length
        ? `read ${plural(tally.sources.length, 'source')} from the live web`
        : 'the web searches came back with nothing usable',
    );
  }

  /**
   * Phase two: force the submit tool and keep forcing it until the schema is
   * satisfied or the repair budget runs out. A rejected report goes back as a
   * `tool_result` marked `is_error`, which is what the model expects to see
   * after a tool call it got wrong.
   */
  private async shape(
    definition: AgentDefinition,
    schema: JsonSchema,
    system: string,
    messages: Anthropic.MessageParam[],
    tally: Tally,
    signal: AbortSignal,
    correcting: boolean,
    onProgress?: (note: string) => void,
  ): Promise<{ output: AgentOutput; repairs: number }> {
    const submit: Anthropic.Tool = {
      name: `submit_${definition.id}_report`,
      description:
        'Submit your completed report. This is the only way to return your work — anything you ' +
        'write outside this call is kept as working notes and is not part of your answer.',
      input_schema: schema as unknown as Anthropic.Tool.InputSchema,
    };

    onProgress?.(correcting ? 'rewriting the flagged findings' : 'shaping findings into the report schema');

    let repairs = 0;
    for (;;) {
      const message = await this.call(
        {
          model: islandConfig.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system,
          messages,
          tools: [submit],
          tool_choice: { type: 'tool', name: submit.name },
        },
        signal,
        onProgress,
      );
      tally.inputTokens += message.usage.input_tokens;
      tally.outputTokens += message.usage.output_tokens;
      this.harvest(message, tally, onProgress);

      const call = message.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === 'tool_use' && block.name === submit.name,
      );

      if (!call) {
        // A forced tool call that produced no call at all is rare, but the
        // repair budget is the right place to spend the one nudge it deserves.
        if (repairs >= islandConfig.maxRepairs) {
          throw new AgentFailure(definition.id, `${definition.name} never called ${submit.name}.`);
        }
        repairs += 1;
        messages.push({ role: 'assistant', content: message.content });
        messages.push({
          role: 'user',
          content: `You did not call ${submit.name}. Call it now with your complete report.`,
        });
        continue;
      }

      const { value, issues } = normaliseAndValidate(call.input, schema);
      if (!issues.length) return { output: value as AgentOutput, repairs };

      if (repairs >= islandConfig.maxRepairs) {
        throw new AgentFailure(
          definition.id,
          `${definition.name} returned a report that still does not match its schema after ` +
            `${plural(repairs, 'repair attempt')}.`,
          issues,
        );
      }

      repairs += 1;
      onProgress?.(`fixing ${plural(issues.length, 'problem')} in the draft report`);
      messages.push({ role: 'assistant', content: message.content });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: call.id,
            is_error: true,
            content:
              'Your report was rejected by the schema. Fix exactly these problems and call the tool ' +
              `again with the whole report, not only the parts you changed:\n${describeIssues(issues)}`,
          },
        ],
      });
    }
  }

  /**
   * One request, with the retry policy the contract fixes: a rate limit earns
   * exactly one wait-and-retry, a dropped connection exactly one immediate
   * retry, and a 400 earns none at all because the request that caused it would
   * only cause it again.
   */
  private async call(
    params: Anthropic.MessageCreateParamsNonStreaming,
    signal: AbortSignal,
    onProgress?: (note: string) => void,
  ): Promise<Anthropic.Message> {
    let retried = false;
    for (;;) {
      try {
        return await this.sdk().messages.create(params, { signal });
      } catch (error) {
        if (retried) throw error;
        if (error instanceof RateLimitError) {
          const wait = retryAfterMs(error);
          onProgress?.(`rate limited, waiting ${Math.round(wait / 1_000)}s before trying again`);
          await sleep(wait, signal);
          retried = true;
          continue;
        }
        if (error instanceof APIConnectionError) {
          onProgress?.('lost the connection to the API, trying once more');
          retried = true;
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Pulls narration, search activity and sources out of one response.
   *
   * Source ids are provisional and numbered in first-seen order within this one
   * invocation. The store renumbers them mission-wide when it records them, so
   * the register the next agent sees is consistent across every agent that ran.
   */
  private harvest(
    message: Anthropic.Message,
    tally: Tally,
    onProgress?: (note: string) => void,
  ): void {
    for (const block of message.content) {
      if (block.type === 'text') {
        const text = block.text.trim();
        if (text) tally.notes.push(text);
        continue;
      }

      if (block.type === 'server_tool_use') {
        const query = (block.input as { query?: unknown } | null)?.query;
        if (typeof query === 'string' && query.trim()) {
          onProgress?.(`searching the web for ${query.trim()}`);
        }
        continue;
      }

      if (block.type !== 'web_search_tool_result') continue;

      // A failed search is a 200 carrying an error object where the results
      // would be, so the shape of `content` is the only thing that tells us.
      if (!Array.isArray(block.content)) {
        onProgress?.(`a web search failed (${block.content.error_code}) — carrying on without it`);
        tally.notes.push(`Web search failed: ${block.content.error_code}.`);
        continue;
      }

      for (const hit of block.content) {
        const url = hit.url.trim();
        if (!url || tally.seenUrls.has(url)) continue;
        tally.seenUrls.add(url);
        tally.sources.push({
          source_id: `S${String(tally.sources.length + 1).padStart(3, '0')}`,
          title: hit.title.trim() || url,
          url,
          ...classify(url),
        });
      }
    }
  }
}
