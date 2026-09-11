import { useEffect, useState } from 'react';
import {
  describeError,
  fetchRoster,
  setAgentEnabled,
  type AgentDefinition,
  type RosterResponse,
} from '../lib/api';
import { canAct, useSession } from '../lib/session';
import { ErrorNote, Loading, Modal, STAGE_LABEL, STAGE_ORDER } from '../components/ui';
import { AgentGlyph } from '../components/glyphs';

export function Agents() {
  const { user } = useSession();
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<AgentDefinition | null>(null);

  useEffect(() => {
    fetchRoster()
      .then(setRoster)
      .catch((caught) => setError(describeError(caught)));
  }, []);

  const mayToggle = canAct(user.role, 'manager');

  function apply(agentId: string, enabled: boolean) {
    setRoster((current) =>
      current
        ? {
            ...current,
            agents: current.agents.map((entry) =>
              entry.definition.id === agentId ? { ...entry, enabled } : entry,
            ),
          }
        : current,
    );
  }

  async function toggle(agentId: string, enabled: boolean) {
    setBusy(agentId);
    setError(null);
    apply(agentId, enabled);
    try {
      await setAgentEnabled(agentId, enabled);
    } catch (caught) {
      setError(describeError(caught));
      // The switch has to show what the server stored, so put it back.
      apply(agentId, !enabled);
    } finally {
      setBusy(null);
    }
  }

  if (error && !roster) return <ErrorNote message={error} />;
  if (!roster) return <Loading rows={4} />;

  const byStage = STAGE_ORDER.map((stage) => ({
    stage,
    entries: roster.agents.filter((entry) => entry.definition.stage === stage),
  })).filter((group) => group.entries.length > 0);

  return (
    <div className="stack stack--lg">
      <div className="page-head">
        <h1 className="page-head__title">Agents</h1>
        <p className="page-head__sub">
          Every agent is a separate model call with its own instructions, its own input and its own
          output contract — not one model playing several parts. Stages run in order; agents inside a
          stage run together when their dependencies allow. Switching an agent off here switches it
          off for every future mission on this account.
        </p>
        <span className="launch__hint">
          Engine: {roster.engineLabel}
          {roster.simulation
            ? ' — no model credential is configured, so these agents return placeholders rather than research.'
            : '.'}
        </span>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      {byStage.map((group) => (
        <section key={group.stage} className="stack">
          <h2 className="eyebrow">{STAGE_LABEL[group.stage]}</h2>
          <div className="agent-grid">
            {group.entries.map(({ definition, enabled }) => (
              <article key={definition.id} className={`agent-card ${enabled ? '' : 'agent-card--off'}`}>
                <div className="agent-card__head">
                  <span className="agent-card__emoji" aria-hidden="true">
                    <AgentGlyph agent={definition.id} size={18} />
                  </span>
                  <div className="grow">
                    <div className="agent-card__name">{definition.name}</div>
                    <div className="agent-card__role">{definition.role}</div>
                  </div>
                  <label className="switch">
                    <input
                      className="switch__input"
                      type="checkbox"
                      checked={enabled}
                      disabled={!mayToggle || busy === definition.id}
                      onChange={(event) => toggle(definition.id, event.target.checked)}
                    />
                    <span className="switch__track">
                      <span className="switch__knob" />
                    </span>
                    <span className="sr-only">
                      {enabled ? `Switch ${definition.name} off` : `Switch ${definition.name} on`}
                    </span>
                  </label>
                </div>

                <p className="agent-card__body">{definition.summary}</p>

                <div className="row row--wrap">
                  <span className="pill pill--muted">{definition.core ? 'Core agent' : 'Specialist'}</span>
                  <span className="pill pill--muted">{STAGE_LABEL[definition.stage]}</span>
                  <span className={`pill ${definition.webSearch ? 'pill--info' : 'pill--muted'}`}>
                    {definition.webSearch ? 'Can search the web' : 'No web access'}
                  </span>
                </div>

                <p className="agent-card__body">
                  {definition.dependsOn.length === 0
                    ? 'Starts first — it depends on nothing.'
                    : `Waits for: ${definition.dependsOn.join(', ')}`}
                </p>

                <div>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setPrompt(definition)}>
                    Read its instructions
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {!mayToggle ? (
        <span className="small muted">
          Only managers and owners can change which agents run. Anyone can read what they were told to
          do.
        </span>
      ) : null}

      {prompt ? (
        <Modal title={`${prompt.name} — system prompt`} onClose={() => setPrompt(null)} wide>
          <div className="stack stack--sm">
            <span className="small muted">
              This is the exact instruction this agent is given on every mission. You are entitled to
              read what the thing acting on your behalf was told to do.
            </span>
            <pre className="prose mono scroller">
              {prompt.systemPrompt || 'The server did not return this agent’s prompt.'}
            </pre>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
