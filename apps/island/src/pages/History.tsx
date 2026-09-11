import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { describeError, listMissions, type MissionRecord, type MissionStatus } from '../lib/api';
import {
  DECISION_LABEL,
  DECISION_PILL,
  Empty,
  ErrorNote,
  Loading,
  StatusPill,
  formatDateTime,
  formatPercent,
} from '../components/ui';

const PAGE = 25;

const FILTERS: { value: MissionStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'awaiting_approval', label: 'Waiting for you' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'aborted', label: 'Stopped' },
];

export function History() {
  const [status, setStatus] = useState<MissionStatus | 'all'>('all');
  const [missions, setMissions] = useState<MissionRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      const response = await listMissions({ limit: PAGE, offset, status });
      setTotal(response.total);
      setMissions((current) =>
        offset === 0 || !current ? response.missions : [...current, ...response.missions],
      );
    },
    [status],
  );

  useEffect(() => {
    setMissions(null);
    setError(null);
    load(0).catch((caught) => setError(describeError(caught)));
  }, [load]);

  async function loadMore() {
    if (!missions) return;
    setLoadingMore(true);
    try {
      await load(missions.length);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="stack">
      <div className="row row--between row--wrap">
        <div className="page-head">
          <h1 className="page-head__title">Missions</h1>
          <p className="page-head__sub">Every mission this account has sent to the island.</p>
        </div>
        <Link className="btn btn--sm" to="/">
          New mission
        </Link>
      </div>

      <div className="tabs" role="tablist" aria-label="Filter missions by status">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            role="tab"
            className="tab"
            aria-selected={status === filter.value}
            onClick={() => setStatus(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error ? <ErrorNote message={error} /> : null}

      {!missions ? (
        <Loading rows={3} />
      ) : missions.length === 0 ? (
        <Empty
          icon=""
          title="No missions yet"
          body="Give the island a question and it starts work immediately."
          action={
            <Link className="btn btn--sm" to="/">
              Start a mission
            </Link>
          }
        />
      ) : (
        <div className="card card--flush">
          <div className="mission-list">
            {missions.map((mission) => (
              <Link key={mission.id} className="mission-item" to={`/missions/${mission.id}`}>
                {/* Blocks rather than spans: the three lines stack on their own,
                    which is one less thing for the stylesheet to have to say. */}
                <div className="grow">
                  <div className="mission-item__ref">{mission.reference}</div>
                  <div className="mission-item__task truncate">{mission.userTask}</div>
                  <div className="mission-item__meta">
                    {formatDateTime(mission.startedAt ?? mission.createdAt)} ·{' '}
                    {mission.createdByName || 'unknown'} ·{' '}
                    {mission.mode === 'approval' ? 'approval gates' : 'automatic'}
                    {mission.engine === 'simulation' ? ' · simulated' : ''}
                  </div>
                </div>

                <div className="row row--wrap">
                  {mission.decision ? (
                    <span className={`pill ${DECISION_PILL[mission.decision]}`}>
                      {DECISION_LABEL[mission.decision]}
                    </span>
                  ) : null}
                  {mission.confidence === null ? null : (
                    <span className="small tabular muted">{formatPercent(mission.confidence)}</span>
                  )}
                  <StatusPill status={mission.status} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {missions && missions.length < total ? (
        <div className="center">
          <button type="button" className="btn btn--sm btn--ghost" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : `Show more (${missions.length} of ${total})`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
