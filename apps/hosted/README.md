# The hosted island

The island as a published Claude Artifact: a single page that runs the whole
orchestration in the browser, calling Claude through the artifact runtime rather
than through this repo's server.

It exists because the server version needs somewhere to run. This one needs a
URL and nothing else, which is what makes it the version a person can actually
open.

## What it is not

**It cannot reach the web.** The artifact sandbox blocks outbound requests to
every host, and the `sample` capability gives the page Claude without a search
tool. So no agent here retrieves anything — every claim is the model reasoning
from training data, which is precisely the failure this product is built to
avoid. The engine is therefore hard about it:

- `VERIFIED` is stripped out of every schema enum before the schema is sent, so
  the model is never offered the label, and any that appears anyway is rewritten.
- Confidence is capped at 0.6, the report's included.
- A URL a model produces is dropped rather than shown, because a link that may
  not exist is worse than no link.
- A standing disclosure sits in `index.html` itself — in the markup, before any
  script runs, so it is on screen even if the script never runs at all.

For a currency question this matters more than for most: a view without current
prices or a verified calendar is a way of structuring your thinking, not an
analysis of the market as it stands. Run the server version with an API key and
a market data key when the answer has to be current.

## Files

| | |
|---|---|
| `index.html` | the page shell and the standing disclosure |
| `island.css` | the design system, ported from `apps/island` |
| `agents.js` | **generated** — the roster, prompts and schemas |
| `engine.js` | the orchestrator: waves, envelopes, the gate, the correction loop |
| `app.js` | the interface and the island map |

`agents.js` is generated from `server/src/island/agents/registry.ts` so the
hosted version runs the same prompts and schemas the server does, rather than a
copy that drifts:

```bash
npx tsx apps/hosted/generate-agents.mjs > apps/hosted/agents.js
```

Regenerate it whenever an agent, a prompt or a schema changes. It is committed
because the page does not run without it.

## Publishing

Published as a multi-file Artifact with `capabilities: {sample: {}, db: {}}` —
`sample` to call Claude, `db` to keep missions. Both can resolve `null` on a
given viewer, and the page renders and explains itself either way rather than
showing a blank screen.
