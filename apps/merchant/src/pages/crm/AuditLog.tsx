import { useEffect, useState } from 'react';
import { api, type AuditEntry } from '../../lib/api';
import { Empty, ErrorNote, Loading, formatDateTime } from '../../components/ui';

const ACTION_LABELS: Record<string, string> = {
  'merchant.created': 'Account created',
  'member.enrolled': 'Member signed up at the counter',
  'member.updated': 'Member record edited',
  'membership.joined': 'Customer joined from the app',
  'members.exported': 'Member list exported',
  'points.awarded': 'Points awarded',
  'points.adjusted': 'Points adjusted manually',
  'reward.redeemed': 'Reward redeemed',
  'redemption.fulfilled': 'Reward handed over',
  'redemption.cancelled': 'Redemption cancelled',
  'team.member_added': 'Team member added',
  'team.member_updated': 'Team member changed',
  'team.member_removed': 'Team member removed',
  'api_key.created': 'Till key created',
  'api_key.revoked': 'Till key revoked',
  'settings.updated': 'Programme settings changed',
  'billing.plan_changed': 'Plan changed',
  'billing.cancelled': 'Subscription cancelled',
  'user.password_changed': 'Password changed',
};

/** A merchant's own audit trail — who did what, when, from where. */
export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ entries: AuditEntry[]; total: number }>('/merchant/account/audit?limit=200')
      .then((response) => {
        setEntries(response.entries);
        setTotal(response.total);
      })
      .catch((caught) => setError((caught as Error).message));
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!entries) return <Loading rows={3} />;

  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        Every action taken in your account, by your team and by your customers. This log is yours
        alone — no other business can see it, and nobody can edit it.
      </p>

      {entries.length === 0 ? (
        <Empty icon="📋" title="Nothing logged yet" body="Actions will appear here as your team uses the CRM." />
      ) : (
        <div className="card card--flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Details</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(entry.createdAt)}</td>
                    <td>
                      <div className="small">{entry.actorLabel || entry.actorType}</div>
                      <div className="tiny muted">{entry.actorType.replace('_', ' ')}</div>
                    </td>
                    <td className="small">{ACTION_LABELS[entry.action] ?? entry.action}</td>
                    <td className="tiny muted" style={{ maxWidth: 300 }}>{summarise(entry.meta)}</td>
                    <td className="tiny muted mono">{entry.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {entries.length > 0 ? (
        <p className="tiny muted" style={{ margin: 0 }}>
          Showing the {entries.length} most recent of {total.toLocaleString()} entries.
        </p>
      ) : null}
    </div>
  );
}

function summarise(meta: Record<string, unknown>): string {
  const parts = Object.entries(meta)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);
  return parts.join(' · ') || '—';
}
