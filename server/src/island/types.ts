/**
 * AI Agent Island — shared vocabulary.
 *
 * The island is a real orchestration engine, not one model impersonating a
 * committee. Every agent is a separate model invocation with its own system
 * prompt, its own input envelope, its own JSON Schema, and its own execution
 * record in the database. This file defines the contracts that the
 * orchestrator, the providers, the routes and the UI all compile against.
 *
 * Design rule that everything else follows: **uncertainty must survive the
 * pipeline.** A claim carries its label and its confidence from the agent that
 * made it all the way to the final report, and no later agent may raise a
 * confidence without attaching new evidence.
 */
import type { PriceSeries } from './marketData';
import type { ResearchSource } from './research';

/** The four labels the whole system uses to grade a claim (never hide doubt). */
export type Label = 'VERIFIED' | 'ESTIMATE' | 'NEEDS_VERIFICATION' | 'HIGH_RISK';

export const LABEL_EMOJI: Record<Label, string> = {
  VERIFIED: '🟢',
  ESTIMATE: '🟡',
  NEEDS_VERIFICATION: '🟠',
  HIGH_RISK: '🔴',
};

export type Severity = 'low' | 'medium' | 'high';
export type Importance = 'low' | 'medium' | 'high';
export type Reliability = 'high' | 'medium' | 'low';
export type SourceType = 'official' | 'news' | 'research' | 'company' | 'social' | 'other';

/** The recommendation the island is allowed to hand back. */
export type Decision = 'proceed' | 'proceed_with_caution' | 'more_research' | 'do_not_proceed';

export const DECISION_LABEL: Record<Decision, string> = {
  proceed: '🟢 PROCEED',
  proceed_with_caution: '🟡 PROCEED WITH CAUTION',
  more_research: '🟠 MORE RESEARCH REQUIRED',
  do_not_proceed: '🔴 DO NOT PROCEED',
};

/** Lifecycle of a whole mission. */
export type MissionStatus =
  | 'created'
  | 'planning'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'aborted';

/** Lifecycle of one agent inside a mission (§14). */
export type AgentState =
  | 'waiting'
  | 'queued'
  | 'working'
  | 'completed'
  | 'failed'
  | 'needs_review'
  | 'retrying'
  | 'blocked'
  | 'skipped';

/** Where an agent sits in the pipeline. Stages run in order; agents inside a
 *  stage run in parallel when their dependencies allow. */
export type Stage = 'plan' | 'gather' | 'analyse' | 'verify' | 'quantify' | 'strategise' | 'review';

export const STAGE_ORDER: Stage[] = [
  'plan',
  'gather',
  'analyse',
  'verify',
  'quantify',
  'strategise',
  'review',
];

export const STAGE_LABEL: Record<Stage, string> = {
  plan: 'Planning',
  gather: 'Gathering',
  analyse: 'Analysis',
  verify: 'Verification',
  quantify: 'Financial',
  strategise: 'Strategy',
  review: 'Chief review',
};

/** How the mission is driven: straight through, or stopping for a human. */
export type MissionMode = 'auto' | 'approval';

/** Which engine actually produced the agent outputs. Recorded per mission so a
 *  report can never be mistaken for real research when no model ran. */
export type EngineKind = 'claude' | 'simulation';

// ---------------------------------------------------------------------------
// The core agent response envelope (§22)
// ---------------------------------------------------------------------------

export interface Evidence {
  /** Reference into the mission's source register, e.g. "S001". Empty when the
   *  claim rests on reasoning rather than a source — which is itself a signal. */
  source_id: string;
  source_title: string;
  source_url: string;
  /** How this source supports the claim, in the agent's own words. */
  support: string;
}

export interface Finding {
  /** Stable within a mission, e.g. "F001". Later agents cite it to challenge it. */
  finding_id: string;
  claim: string;
  category: string;
  importance: Importance;
  label: Label;
  evidence: Evidence[];
  confidence: number;
}

/** A problem one agent found in another agent's work (§6). */
export interface Issue {
  issue_id: string;
  /** Agent whose work is being challenged. Empty when the issue is the agent's own. */
  target_agent: string;
  /** Finding being challenged, e.g. "F002". Empty for a general issue. */
  target_finding_id: string;
  problem: string;
  severity: Severity;
  required_action: string;
}

export interface Recommendation {
  priority: number;
  action: string;
  reason: string;
}

export interface SourceRecord {
  source_id: string;
  title: string;
  url: string;
  source_type: SourceType;
  reliability: Reliability;
}

/** Every agent returns at least this. Agent-specific fields sit alongside. */
export interface AgentOutputCore {
  mission_id: string;
  agent: string;
  status: 'completed' | 'corrected' | 'failed';
  findings: Finding[];
  evidence: Evidence[];
  issues: Issue[];
  assumptions: string[];
  recommendations: Recommendation[];
  /** Hand-off note for whoever runs next (§23). */
  next_agent_instructions: string;
  confidence: number;
}

/** What actually comes back: the core envelope plus the agent's own fields. */
export type AgentOutput = AgentOutputCore & Record<string, unknown>;

// ---------------------------------------------------------------------------
// The mission envelope handed to an agent (§20.1)
// ---------------------------------------------------------------------------

/** A trimmed view of an earlier agent's work (§23 — enough context, no flood). */
export interface Handoff {
  from_agent: string;
  to_agent: string;
  mission_id: string;
  completed_work: string[];
  important_findings: Finding[];
  questions_to_check: string[];
  warnings: string[];
  sources: SourceRecord[];
}

export interface ResearchQuestion {
  question_id: string;
  question: string;
  priority: Importance;
}

export interface CorrectionIssue {
  issue_id: string;
  agent: string;
  finding_id: string;
  problem: string;
  severity: Severity;
  required_action: string;
}

/** Sent to an agent when the verification gate rejected its work (§20.8). */
export interface CorrectionRequest {
  mission_id: string;
  correction_required: true;
  issues: CorrectionIssue[];
  retry_number: number;
  maximum_retries: number;
}

export interface MissionEnvelope {
  mission_id: string;
  mission_reference: string;
  original_task: string;
  objective: string;
  user_requirements: string[];
  constraints: string[];
  geography: string;
  language: string;
  currency: string;
  current_stage: Stage;
  previous_agent: string | null;
  /** Full structured outputs of every agent this one depends on. */
  previous_outputs: AgentOutput[];
  /** Trimmed hand-offs, in execution order. */
  handoffs: Handoff[];
  research_questions: ResearchQuestion[];
  available_sources: SourceRecord[];
  /** Real prices, when a feed is configured and the mission concerns a pair.
   *  Absent means no feed — which the agent must report rather than paper over. */
  market_data?: PriceSeries;
  /** Pages the server retrieved for this agent, each carrying the status of its
   *  own retrieval. Absent means no connector ran — which the agent must report
   *  as a gap rather than fill in. */
  research_sources?: ResearchSource[];
  /** Present only on a correction round. */
  correction?: CorrectionRequest;
  instructions: string;
}

// ---------------------------------------------------------------------------
// Agent definitions (§19 — each agent owns its prompt, schema, deps and tools)
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  id: string;
  name: string;
  emoji: string;
  role: string;
  stage: Stage;
  /** Agent ids that must complete before this one starts. Drives the DAG. */
  dependsOn: string[];
  /** Part of the standard seven-agent island, or an optional specialist (§9). */
  core: boolean;
  enabledByDefault: boolean;
  /** May this agent reach the live web? Only research-shaped agents may. */
  webSearch: boolean;
  /** Should the orchestrator fetch prices for this agent before it runs? Set on
   *  the one agent whose job is unanswerable without them; every other agent's
   *  envelope stays free of prices it never asked to reason about. */
  needsMarketData?: boolean;
  /** Should the orchestrator retrieve the configured research connectors before
   *  this agent runs? Set on the one agent whose job is gathering evidence; an
   *  agent that did not ask to read the web should not find pages in its
   *  envelope and start treating them as its own findings. */
  needsResearch?: boolean;
  /** Agent to fall back to if this one fails repeatedly (§16). Usually none. */
  backupAgentId?: string;
  systemPrompt: string;
  /** JSON Schema the orchestrator enforces on every response (§21 rule 2). */
  outputSchema: JsonSchema;
  /** Where the agent sits on the island map, in 0-100 viewBox units. */
  map: { x: number; y: number };
  /** One-line summary of what this agent is for, shown in the roster. */
  summary: string;
}

// ---------------------------------------------------------------------------
// A minimal JSON Schema dialect — the same object is sent to the model as the
// structured-output format AND used to validate what comes back, so the
// contract cannot drift between the two.
// ---------------------------------------------------------------------------

export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';

export interface JsonSchema {
  type: JsonSchemaType;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: JsonSchema;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  maxLength?: number;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Execution records
// ---------------------------------------------------------------------------

export interface AgentRunRecord {
  id: string;
  missionId: string;
  agentId: string;
  attempt: number;
  round: number;
  status: AgentState;
  input: MissionEnvelope | null;
  output: AgentOutput | null;
  error: string | null;
  confidence: number | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Raw model narration kept for audit: how the agent reasoned before shaping. */
  notes: string | null;
}

export interface MissionRecord {
  id: string;
  reference: string;
  merchantId: string;
  userTask: string;
  objective: string;
  geography: string;
  language: string;
  currency: string;
  constraints: string[];
  userRequirements: string[];
  status: MissionStatus;
  mode: MissionMode;
  engine: EngineKind;
  enabledAgents: string[];
  currentStage: Stage | null;
  pendingApprovalStage: Stage | null;
  decision: Decision | null;
  confidence: number | null;
  finalReport: FinalReport | null;
  error: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

/** One entry in the correction audit trail (§21 rule 4 — no silent fixes). */
export interface CorrectionRecord {
  id: string;
  missionId: string;
  findingId: string;
  fromAgent: string;
  toAgent: string;
  originalClaim: string;
  correctedClaim: string;
  reason: string;
  severity: Severity;
  round: number;
  resolved: boolean;
  createdAt: string;
}

export interface VerificationRecord {
  id: string;
  missionId: string;
  findingId: string;
  agentId: string;
  status: 'verified' | 'needs_verification' | 'contradiction' | 'high_risk';
  reason: string;
  severity: Severity;
  recommendedAction: string;
  correctedValue: string;
  resolved: boolean;
  round: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Live mission events (§5, §6 — the island animation is a view of these)
// ---------------------------------------------------------------------------

export type MissionEventType =
  | 'mission_created'
  | 'mission_started'
  | 'stage_started'
  | 'agent_queued'
  | 'agent_started'
  | 'agent_progress'
  | 'agent_completed'
  | 'agent_failed'
  | 'agent_retrying'
  | 'agent_skipped'
  | 'handoff'
  | 'challenge'
  | 'correction_requested'
  | 'correction_applied'
  | 'verification_result'
  | 'approval_required'
  | 'approval_granted'
  | 'mission_paused'
  | 'mission_resumed'
  | 'mission_completed'
  | 'mission_failed'
  | 'mission_aborted'
  | 'log';

export interface MissionEvent {
  id: string;
  missionId: string;
  seq: number;
  type: MissionEventType;
  agentId: string | null;
  /** Free-form, type-specific. Always JSON-serialisable. */
  payload: Record<string, unknown>;
  message: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// The final report (§12)
// ---------------------------------------------------------------------------

export interface ReportKeyFinding {
  finding: string;
  evidence: string[];
  label: Label;
  confidence: number;
}

export interface FinalReport {
  mission_id: string;
  mission_reference: string;
  generated_at: string;
  engine: EngineKind;
  original_task: string;
  executive_summary: string;
  key_findings: ReportKeyFinding[];
  research_summary: string;
  competitor_summary: string;
  market_summary: string;
  analysis_summary: string;
  financial_summary: {
    estimated_startup_cost: number;
    estimated_monthly_cost: number;
    estimated_monthly_revenue: number;
    currency: string;
    note: string;
  };
  major_risks: string[];
  verification: {
    total_claims_reviewed: number;
    verified: number;
    needs_verification: number;
    contradictions: number;
    high_risk_items: number;
    rounds_used: number;
    passed: boolean;
  };
  strategy_summary: string;
  recommendation: { decision: Decision; reason: string };
  action_plan: Recommendation[];
  assumptions: string[];
  unresolved_questions: string[];
  unresolved_issues: CorrectionIssue[];
  corrections: CorrectionRecord[];
  sources: SourceRecord[];
  overall_confidence: number;
  confidence_explanation: string;
  agent_summary: { agent: string; name: string; status: string; key_contribution: string }[];
  /** Set when no live model ran. The UI must surface this prominently. */
  simulation_notice: string;
  /**
   * Every place assembly had to overrule what an agent said, because the record
   * did not support it — a citation to a source that was never registered, a
   * VERIFIED label with nothing behind it, a tally that disagreed with the
   * verification rows, a confidence above what the mission earned.
   *
   * This is printed in the report rather than applied quietly. A correction the
   * reader cannot see is just a different agent's word for it, and the point of
   * reconciling against the record is that the reader no longer has to take
   * anyone's word.
   */
  integrity_notes: string[];
}

// ---------------------------------------------------------------------------
// Provider contract (§19 — the engine behind every agent invocation)
// ---------------------------------------------------------------------------

export interface AgentInvocation {
  definition: AgentDefinition;
  envelope: MissionEnvelope;
  /** Abort signal so a paused or aborted mission stops calling the model. */
  signal?: AbortSignal;
  /** Called with short human-readable progress notes as the agent works. */
  onProgress?: (note: string) => void;
}

export interface AgentInvocationResult {
  output: AgentOutput;
  /** Sources the agent actually consulted, harvested from live web search. */
  sources: SourceRecord[];
  notes: string;
  inputTokens: number;
  outputTokens: number;
  /** How many schema-repair round trips it took. 0 means first-try valid. */
  repairs: number;
}

export interface AgentProvider {
  readonly kind: EngineKind;
  readonly label: string;
  run(invocation: AgentInvocation): Promise<AgentInvocationResult>;
}

/** Thrown when an agent could not produce schema-valid output. */
export class AgentFailure extends Error {
  constructor(
    readonly agentId: string,
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'AgentFailure';
  }
}
