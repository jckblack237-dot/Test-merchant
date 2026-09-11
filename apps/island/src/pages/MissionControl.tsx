import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createMission,
  describeError,
  fetchRoster,
  type AgentState,
  type MissionMode,
  type RosterResponse,
} from '../lib/api';
import { canAct, useSession } from '../lib/session';
import { ErrorNote, Loading, STAGE_LABEL } from '../components/ui';
import { Island } from '../components/Island';

const MODES: { value: MissionMode; title: string; body: string }[] = [
  {
    value: 'auto',
    title: 'Automatic',
    body: 'The island runs the whole mission end to end and tells you when it is done.',
  },
  {
    value: 'approval',
    title: 'Approval gates',
    body: 'The island stops after each stage and waits for you to read it and approve.',
  },
];

export function MissionControl() {
  const { user } = useSession();
  const navigate = useNavigate();

  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [task, setTask] = useState('');
  const [objective, setObjective] = useState('');
  const [geography, setGeography] = useState('');
  const [currency, setCurrency] = useState('');
  const [constraints, setConstraints] = useState('');
  const [mode, setMode] = useState<MissionMode>('auto');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetchRoster()
      .then((response) => {
        setRoster(response);
        setPicked(
          Object.fromEntries(
            response.agents
              .filter((entry) => !entry.definition.core)
              .map((entry) => [entry.definition.id, entry.enabled]),
          ),
        );
      })
      .catch((caught) => setError(describeError(caught)));
  }, []);

  const chosen = useMemo(() => {
    if (!roster) return [] as string[];
    return roster.agents
      .filter((entry) => (entry.definition.core ? entry.enabled : picked[entry.definition.id] === true))
      .map((entry) => entry.definition.id);
  }, [roster, picked]);

  // The idle map previews the crew: whoever is on this mission waits on the
  // beach, whoever is switched off is greyed out as skipped.
  const states = useMemo(() => {
    const sailing = new Set(chosen);
    const map: Record<string, AgentState> = {};
    for (const entry of roster?.agents ?? []) {
      map[entry.definition.id] = sailing.has(entry.definition.id) ? 'waiting' : 'skipped';
    }
    return map;
  }, [roster, chosen]);

  const mayStart = canAct(user.role, 'manager');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!task.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const mission = await createMission({
        task: task.trim(),
        objective: objective.trim() || undefined,
        geography: geography.trim() || undefined,
        currency: currency.trim().toUpperCase() || undefined,
        constraints: constraints
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        agents: chosen,
        mode,
      });
      navigate(`/missions/${mission.id}`);
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  if (error && !roster) return <ErrorNote message={error} />;
  if (!roster) return <Loading rows={3} />;

  const core = roster.agents.filter((entry) => entry.definition.core);
  const optional = roster.agents.filter((entry) => !entry.definition.core);
  const chosenMode = MODES.find((option) => option.value === mode);

  return (
    <div className="stack stack--lg">
      <div className="page-head">
        <h1 className="page-head__title">Mission control</h1>
        <p className="page-head__sub">
          One task, one island, one audited answer. Every agent works separately, cites what it read
          and is challenged by the ones that come after it.
        </p>
      </div>

      {roster.simulation ? (
        <div className="sim-notice" role="alert">
          <span aria-hidden="true">⚠️</span>
          <div className="stack stack--sm">
            <strong>Simulation engine — nothing here will be researched.</strong>
            <span>
              No model credential is configured on this server, so the island cannot call a model or
              reach the web. It still runs the whole pipeline, but every agent returns a placeholder
              whose findings are labelled NEEDS_VERIFICATION, carry no sources and hold low
              confidence. Do not treat the output of a simulated mission as research.
            </span>
          </div>
        </div>
      ) : (
        <p className="launch__hint" style={{ margin: 0 }}>
          Engine: {roster.engineLabel}. Agents allowed to search will cite every source they read.
        </p>
      )}

      <form className="stack stack--lg" onSubmit={submit}>
        <div className="card card--sea launch">
          <label className="field">
            <span className="page-head__title">What do you want the AI Island to investigate?</span>
            <textarea
              className="textarea"
              style={{ minHeight: 132, fontSize: 15 }}
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder="e.g. Should I open a speciality coffee shop in Galway city centre? I have €60,000 and no hospitality experience."
              required
              disabled={!mayStart}
            />
            <span className="launch__hint">
              Write it the way you would ask a person. The Task Manager turns it into a plan and picks
              the agents the question actually needs.
            </span>
          </label>

          <div className="row row--between row--wrap">
            <span className="launch__hint">
              {chosen.length} agent{chosen.length === 1 ? '' : 's'} · {chosenMode?.title.toLowerCase()}
            </span>
            <button className="btn btn--lg" type="submit" disabled={!mayStart || busy || !task.trim()}>
              {busy ? 'Launching…' : 'START MISSION 🚀'}
            </button>
          </div>

          {!mayStart ? (
            <p className="small muted" style={{ margin: 0 }}>
              Missions cost model time, so only managers and owners can start one. You can read every
              mission and its report.
            </p>
          ) : null}

          {error ? <ErrorNote message={error} /> : null}
        </div>

        <div className="grid grid--2">
          <div className="card stack">
            <h2 className="report__heading">How should it run?</h2>
            <div className="tabs" role="tablist" aria-label="Mission mode">
              {MODES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  className="tab"
                  aria-selected={mode === option.value}
                  onClick={() => setMode(option.value)}
                  disabled={!mayStart}
                >
                  {option.title}
                </button>
              ))}
            </div>
            <p className="small muted" style={{ margin: 0 }}>{chosenMode?.body}</p>
          </div>

          <div className="card stack">
            <h2 className="report__heading">Context (optional)</h2>
            <div className="grid grid--2">
              <label className="field">
                <span className="field__label">Geography</span>
                <input
                  className="input"
                  value={geography}
                  onChange={(event) => setGeography(event.target.value)}
                  placeholder="Galway, Ireland"
                  disabled={!mayStart}
                />
              </label>
              <label className="field">
                <span className="field__label">Currency</span>
                <input
                  className="input mono"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  placeholder="EUR"
                  maxLength={3}
                  style={{ textTransform: 'uppercase' }}
                  disabled={!mayStart}
                />
              </label>
            </div>
            <label className="field">
              <span className="field__label">Objective</span>
              <input
                className="input"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                placeholder="Decide whether to sign the lease before March"
                disabled={!mayStart}
              />
            </label>
            <label className="field">
              <span className="field__label">Constraints, one per line</span>
              <textarea
                className="textarea"
                style={{ minHeight: 72 }}
                value={constraints}
                onChange={(event) => setConstraints(event.target.value)}
                placeholder={'Budget under €60,000\nMust open within 9 months'}
                disabled={!mayStart}
              />
            </label>
          </div>
        </div>

        <section className="stack">
          <div className="row row--between row--wrap">
            <h2 className="report__heading">Who sails on this mission?</h2>
            <span className="launch__hint">
              Core agents always run. Specialists are switched on for this mission only.
            </span>
          </div>

          <div className="row row--wrap" style={{ gap: 6 }}>
            {core.map(({ definition, enabled }) => (
              <span
                key={definition.id}
                className={`pill ${enabled ? 'pill--brand' : 'pill--muted'}`}
                title={enabled ? definition.summary : 'Switched off for this account on the Agents page.'}
              >
                {definition.emoji} {definition.name}
                {enabled ? '' : ' · off'}
              </span>
            ))}
          </div>

          {optional.length === 0 ? null : (
            <div className="agent-grid">
              {optional.map(({ definition }) => {
                const on = picked[definition.id] === true;
                return (
                  <label key={definition.id} className={`agent-card ${on ? 'is-selected' : 'agent-card--off'}`}>
                    <span className="agent-card__head">
                      <span className="agent-card__emoji" aria-hidden="true">{definition.emoji}</span>
                      <span className="grow">
                        <span className="agent-card__name">{definition.name}</span>
                        <span className="agent-card__role">
                          {STAGE_LABEL[definition.stage]} · {definition.role}
                        </span>
                      </span>
                      <span className="switch">
                        <input
                          className="switch__input"
                          type="checkbox"
                          checked={on}
                          disabled={!mayStart}
                          onChange={(event) =>
                            setPicked((current) => ({ ...current, [definition.id]: event.target.checked }))
                          }
                        />
                        <span className="switch__track">
                          <span className="switch__knob" />
                        </span>
                      </span>
                    </span>
                    <p className="agent-card__body">{definition.summary}</p>
                  </label>
                );
              })}
            </div>
          )}
        </section>
      </form>

      <section className="card stack">
        <div className="row row--between row--wrap">
          <h2 className="report__heading">The island</h2>
          <span className="launch__hint">
            {selected
              ? roster.agents.find((entry) => entry.definition.id === selected)?.definition.summary
              : 'Tap a hut to read what that agent does.'}
          </span>
        </div>
        <Island
          agents={roster.agents.map((entry) => entry.definition)}
          states={states}
          activeTransfer={null}
          onSelect={(agentId) => setSelected((current) => (current === agentId ? null : agentId))}
          selected={selected}
        />
      </section>
    </div>
  );
}
