# AI Agent Island

One task in. An audited report out, produced by seventeen separate AI agents that
research it, argue with each other, send failed work back, cost it out and then
have a chief reviewer throw out whatever does not hold up.

The island in the interface is a picture of a real thing. Behind it is an
orchestrator that plans a dependency graph, runs agents in parallel where it
can, validates every response against a JSON Schema, keeps a correction trail,
and refuses to let confidence grow as work moves downstream.

---

## The rule the whole system is built around

**Nothing is presented as more certain than it is.**

Every claim any agent makes carries one of four labels, and the label travels
with it into the final report:

| | |
|---|---|
| 🟢 `VERIFIED` | A real source was retrieved and it says this. |
| 🟡 `ESTIMATE` | Calculated or judged. Never a fact. |
| 🟠 `NEEDS_VERIFICATION` | A person has to confirm this before acting on it. |
| 🔴 `HIGH_RISK` | A contradiction, or an unknown big enough to sink the idea. |

Three mechanisms keep those labels honest rather than decorative:

- **Agents challenge each other.** Every agent is instructed to review the work
  it was handed and to record what is wrong with it. Challenges are stored with
  the original claim, the corrected claim, who changed it and why — so a finding
  can never be quietly rewritten.
- **A verification gate.** The Risk & Verification Agent audits the whole body of
  work and can fail it. Failing it sends the specific findings back to the agents
  responsible for a correction round, then re-audits. Three rounds; after that
  whatever is still open is printed in the report as unresolved.
- **Confidence cannot grow on its own.** If a later agent restates an earlier
  finding at a higher confidence without attaching new evidence, the orchestrator
  clamps it back to where it started and says so in the timeline.

---

## The roster

Nine core agents always sail. Eight specialists are switched on per merchant —
five general, plus a three-agent forex desk.

| Agent | Stage | Waits for | Web |
|---|---|---|---|
| 🧭 Task Manager | Planning | — | |
| 🔍 Research Agent | Gathering | Task Manager | ● |
| 🕵️ Competitor Agent | Gathering | Research | ● |
| 🗣️ Customer Research Agent *(specialist)* | Gathering | Task Manager | ● |
| 🛠️ Technology Agent *(specialist)* | Gathering | Task Manager | |
| ⚖️ Legal & Compliance Agent *(specialist)* | Gathering | Task Manager | ● |
| 📊 Market Analysis Agent | Analysis | Research, Competitor | |
| 🧩 Analysis Agent | Analysis | Research | |
| 📣 Marketing Agent *(specialist)* | Analysis | Market Analysis | |
| 🛡️ Risk & Verification Agent | Verification | Research, Analysis | |
| 💰 Financial Agent | Financial | Risk & Verification | |
| ⚙️ Operations Agent *(specialist)* | Financial | Risk & Verification | |
| ♟️ Strategy Agent | Strategy | Financial, Risk & Verification | |
| 🌍 Market Context Agent *(forex)* | Gathering | Task Manager | ● |
| 📈 Technical Analysis Agent *(forex)* | Analysis | Market Context | |
| 🎯 Trade Thesis Agent *(forex)* | Strategy | Technical Analysis, Risk & Verification | |
| 👑 Chief AI Agent | Chief review | Strategy | |

The Task Manager, the Risk & Verification Agent and the Chief AI cannot be
switched off. They are the three that plan the work and check the answer, and a
mission without them would be a chatbot with extra steps.

### Adding an agent

One entry in `server/src/island/agents/registry.ts` and one prompt in
`agents/prompts.ts`. An agent needs no schema of its own — `SPECIALIST_SCHEMA`
covers it, and the simulation engine derives its placeholder output from the
schema, so nothing else in the system has to learn the new agent exists. Give it
a `dependsOn` and the orchestrator will schedule it.

Write one when the agent's output has a shape worth naming, core or not: add it
to `SCHEMAS_BY_AGENT` and `schemaFor` hands it over. Being a specialist is about
whether an agent is on by default and nothing else — the three forex agents are
opt-in and have the most specific schemas in the file. A schema that exists but
is never handed to its agent is worse than none: the prompt then describes
fields the model is never offered, and `stripUnknown` deletes them if it
produces them anyway. `islandContract.test.ts` asserts against the live schema
for exactly that reason.

---

## How a mission runs

```
          USER
            │
     MISSION CONTROL
            │
      ORCHESTRATOR ──────────────┐
            │                    │  every state change is an event,
      TASK MANAGER               │  stored first and streamed second
            │                    │
   ┌────────┴────────┐           ▼
   ▼                 ▼      island_events ──► SSE ──► the island animating
 RESEARCH       SPECIALISTS
   └────────┬────────┘
            ▼
      VERIFICATION GATE
            │
     ┌──────┴──────┐
   FAILED        PASSED
     │             │
  correction    FINANCIAL
   round           │
     │          STRATEGY
     └──►(≤3)      │
                CHIEF AI
                   │
             FINAL REPORT
```

1. **Plan.** The Task Manager turns the request into an objective, success
   criteria, research questions and a list of the agents the task actually needs.
   It may narrow the roster but never widen it past what the merchant enabled.
2. **Schedule.** The orchestrator topologically sorts the enabled agents into
   waves. Agents in the same wave run concurrently, capped by
   `ISLAND_MAX_CONCURRENCY`.
3. **Run.** Each agent gets a mission envelope: the original task, the objective,
   the research questions, the *full* output of every agent it depends on,
   trimmed hand-offs from everyone else, and the shared source register. The
   exact envelope is stored, which is what makes "why did it say that?"
   answerable later.
4. **Validate.** The response must match that agent's JSON Schema. If it does
   not, the agent is handed the specific validation errors and asked to fix its
   own answer. Twice. Then it has failed, and the report says so.
5. **Verify.** The gate runs. If it fails, the correction loop runs.
6. **Review.** The Chief AI reads the whole package and re-decides. It is
   instructed to reject weak conclusions and to say which ones it rejected.
7. **Report.** Assembled from what is on record, never from what would read well.

### If something goes wrong

An agent that fails is retried (`ISLAND_MAX_ATTEMPTS`), then falls back to a
backup agent if its definition names one, then is marked `failed` and the
mission carries on without it. Agents that depended on it are marked `blocked`.
A failed agent is never reported as completed, and the report's agent appendix
shows exactly what each one did or did not contribute.

If the server restarts mid-mission, every mission still claiming to be running is
closed out at boot with an explanation. A mission never sits in the interface
looking alive when nothing is running.

---

## Running without a model

With no `ANTHROPIC_API_KEY` configured the island runs on the **simulation
engine**. This exists so the pipeline can be demonstrated and tested, and it is
built around a single rule: it fabricates nothing.

It invents no source, no URL, no statistic, no competitor and no price. Its
output is shaped from each agent's own JSON Schema, every finding is labelled
`NEEDS_VERIFICATION` with no evidence and a confidence of 0.2, and the text of
every claim says in plain words that no model ran. It still raises a real
challenge against an upstream finding and still fails the first verification
round, so the correction loop genuinely executes.

Every simulated mission is stamped `engine: simulation` in the database, banners
say so in the interface, and the report carries the notice at the top. A
simulated report cannot be mistaken for research — that is the whole point of
building it this way rather than seeding it with plausible-looking demo data.

---

## When the model goes away mid-mission

The simulation engine covers *starting* without a model. The harder case is a
live mission whose model service drops out partway through — a 529, an expired
key, a network partition — and it is handled on the opposite principle to the
one most systems reach for. The island **never manufactures a report for an
agent that did not run.** There is no template, no framework prose, no
"evidence-limited" stand-in stored as though it were the agent's own output. An
agent that is out of attempts is recorded as failed, everything downstream of it
is recorded as blocked, and the report is assembled from what is left.

What changes is the arithmetic. Two rules stop a partial mission from reading
like a complete one:

**The roster ceiling.** A mission cannot be held more confidently than the share
of its own roster that reported at all. Eleven agents of seventeen means the
overall confidence is capped at 11/17, whatever the chief agent claims. The
figure comes from counting run rows, not from asking an agent to be modest — the
chief reading eleven handoffs has no way to notice the six that are missing,
because a hole leaves no trace in the text it was given.

**The roster note.** Every agent that never reported is named in
`integrity_notes`, with its status, whether or not the confidence also needed
capping. Those notes print in the report under *What this report had to
correct*, so the artifact a person downloads carries the gap rather than only
the screen they read it on.

When *nothing* reports, the mission is marked `failed` and says why — but it
still produces a report. That report has no findings, no sources, a
`more_research` recommendation and a confidence of zero, every one of those
arrived at by the reconciliation reading empty rows rather than by anything
composing a stand-in. What it does carry is the record: which agents were
attempted, what each one failed with, and which research connectors answered.
A failed mission that vanishes teaches nobody anything about why it failed.

---

## The API

Everything lives under `/api/island` and requires a signed-in merchant staff
account. Point-of-sale API keys are refused: a key that exists to award points at
a till has no business reading a merchant's strategy or spending their model
budget.

| Method | Path | Role | |
|---|---|---|---|
| `GET` | `/agents` | staff | Roster, engine, today's mission count |
| `PATCH` | `/agents/:agentId` | manager | Switch an agent on or off |
| `GET` | `/missions` | staff | Mission history |
| `POST` | `/missions` | manager | Create and start a mission |
| `GET` | `/missions/:id` | staff | Mission, runs, events, sources, corrections |
| `GET` | `/missions/:id/runs/:runId` | staff | One run, including the envelope it was given |
| `GET` | `/missions/:id/stream` | staff | Live events (SSE) |
| `GET` | `/missions/:id/report` | staff | Final report; `?format=markdown` |
| `POST` | `/missions/:id/pause` `/resume` `/abort` `/approve` | manager | Controls |
| `POST` | `/missions/:id/followups` | staff | Ask about a finished mission |
| `DELETE` | `/missions/:id` | owner | Delete a finished mission |

### The event stream

`GET /missions/:id/stream` is Server-Sent Events. It is read with `fetch` and a
stream reader rather than `EventSource`, because `EventSource` cannot set an
`Authorization` header and the alternative — a token in the query string — ends
up in access logs and browser history.

Each event carries its `seq` as the SSE `id`, so a client that drops reconnects
with `Last-Event-ID` (or `?afterSeq=`) and resumes exactly where it was. Events
are written to `island_events` *before* they are published, so a replay can never
miss one that a subscriber already saw. The stream closes itself when the mission
reaches a terminal state.

---

## Tenancy

A mission is a merchant asking, in their own words, what they are thinking of
building. It is the most sensitive thing this platform stores, and it is scoped
exactly like everything else: every island table carries a `merchant_id`, is
registered in `TENANT_TABLES`, and is reached only through `TenantStore`. The
boot-time check in `assertTenantTablesAreScoped()` covers them too.

`server/tests/islandIsolation.test.ts` hands one merchant another merchant's real
mission id, run id and a perfectly valid token, and proves every read, every
control and every delete comes back as a 404 — not a 403, because confirming the
id is real would itself leak something.

The agent roster is the one island table that is *not* tenant scoped. Prompts and
dependencies are product code, identical for everyone; only the on/off switches
in `island_agent_settings` belong to a merchant.

---

## Configuration

See `.env.example`. The settings that matter:

| | |
|---|---|
| `ANTHROPIC_API_KEY` | Unset means the simulation engine. |
| `ISLAND_MODEL` | Default `claude-opus-5`. |
| `ISLAND_MAX_CONCURRENCY` | Model calls in flight at once. |
| `ISLAND_MAX_CORRECTION_ROUNDS` | Times work may be sent back before its issues are recorded unresolved. |
| `ISLAND_MISSIONS_PER_DAY` | Per merchant. A mission is a dozen-odd model calls. |
| `ISLAND_ENABLED` | `false` refuses new missions without taking the pages away. |

The pinned SDK is `@anthropic-ai/sdk` 0.70.x, which has no response-format
parameter. Structured output is therefore a **forced tool call**: each agent's
JSON Schema is sent as a tool's `input_schema` with `tool_choice` making the call
mandatory, so what comes back is already-parsed JSON rather than prose that has
to be scraped. Research agents run two phases — a search turn with
`web_search_20250305`, then the forced submit turn. A web search that fails
arrives as a normal `200` carrying an error object where the results would be, so
the code branches on the shape of `content` rather than catching an exception
that never comes.

---

## Research connectors

The island had one way to learn anything it did not already know: the model's
own web search, which needs an API key. Without one, no mission had ever
retrieved a page, and every source in every report was something a model said
existed.

`server/src/island/research.ts` is the other way. A connector names a specific
public page up front, fetches it, and reports one of exactly three outcomes:

| Outcome | Content | Citable | On the timeline |
|---|---|---|---|
| `retrieved` | the stripped text | yes — it enters the source register | how many, how long |
| `unavailable` | none | no | why it failed |
| `auth_required` | none | no | which env var, and where to get a token |

The third is where most systems quietly lie. A connector needing a credential it
does not have reports `auth_required` and names the page a token comes from. It
does not guess what the source would have said, and it does not drop itself from
the record so the gap goes unnoticed.

Only `retrieved` connectors become citable sources, and that is what makes this
more than plumbing. `report.ts` refuses a VERIFIED label to any claim whose
citations are not in the mission's source register — so before connectors
existed, VERIFIED was unreachable by construction. Now a claim can earn it.

Connectors run only under a real engine. Under the simulation engine nothing is
fetched, because a report carrying freshly retrieved sources beside placeholder
findings invites exactly the misreading the whole system exists to prevent.

The shipped list is Maldives statistics, since that is the market LoyaltyLoop
serves. `RESEARCH_CONNECTORS` overrides it; see `.env.example`.

---

## Where things are

```
server/src/island/
  types.ts            every shared type; the vocabulary the rest compiles against
  schemas.ts          one JSON Schema per agent — sent to the model AND validated against
  validate.ts         the validator, and the repair messages it produces
  config.ts           environment, and which engine is live
  agents/
    prompts.ts        one system prompt per agent, over shared house rules
    registry.ts       the dependency graph, the map, the roster table
  provider/
    claude.ts         real invocation: search, forced tool call, repair loop
    simulation.ts     the honest offline engine
  research.ts         the connectors: pages actually retrieved, and the gaps named
  marketData.ts       the price feed: a real series, or null, and no third state
  orchestrator.ts     waves, hand-offs, the verification gate, the correction loop
  store.ts            persistence and the audit trail
  events.ts           the in-process bus behind SSE
  report.ts           the final report, and its markdown rendering
  followup.ts         questions about a finished mission, answered only from it
server/src/routes/island/   the HTTP surface
apps/island/                the dashboard (Vite, port 5175)
```

Tests: `server/tests/islandContract.test.ts` (schemas and the DAG),
`islandStore.test.ts` (persistence and the event sequence),
`islandMission.test.ts` (a whole mission, end to end),
`islandIsolation.test.ts` (one merchant attacking another),
`islandConfidence.test.ts` (confidence cannot grow without new evidence).
