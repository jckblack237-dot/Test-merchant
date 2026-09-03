import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, type CatalogItem } from '../../lib/api';
import { canAct, useSession } from '../../lib/session';
import { Empty, ErrorNote, Loading, Modal, formatMoney, formatNumber } from '../../components/ui';
import { describeError } from '../site/SignUp';

type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'checkbox' | 'color' | 'select' | 'list';

interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  hint?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  min?: number;
  step?: number;
  defaultValue?: unknown;
}

interface ResourceSpec {
  path: string;
  singular: string;
  plural: string;
  icon: string;
  emptyBody: string;
  writeRole: 'owner' | 'manager';
  fields: FieldSpec[];
  columns: { label: string; render: (item: any, currency: string) => ReactNode; align?: 'right' }[];
}

/**
 * The catalogue screens (locations, products, rewards, tiers, campaigns) are the
 * same CRUD table with different fields, so they are described as data rather
 * than written out five times.
 */
function ResourceManager({ spec }: { spec: ResourceSpec }) {
  const { merchant, user, subscription } = useSession();
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null);

  const load = useCallback(async () => {
    const response = await api<{ items: CatalogItem[] }>(`/merchant/catalog/${spec.path}`);
    setItems(response.items);
  }, [spec.path]);

  useEffect(() => {
    setItems(null);
    load().catch((caught) => setError((caught as Error).message));
  }, [load]);

  const canWrite = canAct(user.role, spec.writeRole) && subscription.writable;

  async function remove(item: CatalogItem) {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    try {
      await api(`/merchant/catalog/${spec.path}/${item.id}`, { method: 'DELETE' });
      await load();
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return (
    <div className="stack">
      <div className="row row--between row--wrap">
        <p className="muted small" style={{ margin: 0 }}>{spec.emptyBody}</p>
        <button type="button" className="btn btn--sm" onClick={() => setEditing('new')} disabled={!canWrite}>
          Add {spec.singular.toLowerCase()}
        </button>
      </div>

      {error ? <ErrorNote message={error} onRetry={() => { setError(null); load().catch(() => {}); }} /> : null}

      {!items ? (
        <Loading rows={2} />
      ) : items.length === 0 ? (
        <Empty
          icon={spec.icon}
          title={`No ${spec.plural.toLowerCase()} yet`}
          body={spec.emptyBody}
          action={
            canWrite ? (
              <button type="button" className="btn" onClick={() => setEditing('new')}>
                Add your first {spec.singular.toLowerCase()}
              </button>
            ) : null
          }
        />
      ) : (
        <div className="card card--flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {spec.columns.map((column) => (
                    <th key={column.label} className={column.align === 'right' ? 'right' : undefined}>
                      {column.label}
                    </th>
                  ))}
                  {canWrite ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={String(item.id)}>
                    {spec.columns.map((column) => (
                      <td key={column.label} className={column.align === 'right' ? 'right' : undefined}>
                        {column.render(item, merchant.currency)}
                      </td>
                    ))}
                    {canWrite ? (
                      <td className="right" style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn btn--sm btn--subtle" onClick={() => setEditing(item)}>
                          Edit
                        </button>{' '}
                        <button type="button" className="btn btn--sm btn--danger" onClick={() => remove(item)}>
                          Delete
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing ? (
        <ResourceForm
          spec={spec}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function ResourceForm({
  spec, item, onClose, onSaved,
}: { spec: ResourceSpec; item: CatalogItem | null; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    for (const field of spec.fields) {
      const existing = item?.[field.key];
      initial[field.key] =
        existing !== undefined && existing !== null
          ? field.type === 'money'
            ? String((existing as number) / 100)
            : field.type === 'list'
              ? (existing as string[]).join('\n')
              : existing
          : field.defaultValue ?? (field.type === 'checkbox' ? true : '');
    }
    return initial;
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Modal title={item ? `Edit ${spec.singular.toLowerCase()}` : `New ${spec.singular.toLowerCase()}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const body: Record<string, unknown> = {};
            for (const field of spec.fields) {
              const raw = values[field.key];
              if (field.type === 'money') body[field.key] = Math.round(Number.parseFloat(raw || '0') * 100);
              else if (field.type === 'number') body[field.key] = Number.parseFloat(raw || '0');
              else if (field.type === 'checkbox') body[field.key] = Boolean(raw);
              else if (field.type === 'list') {
                body[field.key] = String(raw)
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean);
              } else body[field.key] = raw;
            }
            await api(`/merchant/catalog/${spec.path}${item ? `/${item.id}` : ''}`, {
              method: item ? 'PATCH' : 'POST',
              body,
            });
            onSaved();
          } catch (caught) {
            setError(describeError(caught));
          } finally {
            setBusy(false);
          }
        }}
      >
        {spec.fields.map((field) => (
          <label key={field.key} className="field">
            <span className="field__label">{field.label}</span>
            {field.type === 'textarea' || field.type === 'list' ? (
              <textarea
                className="textarea"
                value={values[field.key] ?? ''}
                onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                required={field.required}
              />
            ) : field.type === 'checkbox' ? (
              <input
                type="checkbox"
                checked={Boolean(values[field.key])}
                onChange={(event) => setValues({ ...values, [field.key]: event.target.checked })}
                style={{ width: 18, height: 18, alignSelf: 'flex-start' }}
              />
            ) : field.type === 'select' ? (
              <select
                className="select"
                value={values[field.key] ?? ''}
                onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
              >
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                type={field.type === 'color' ? 'color' : field.type === 'text' ? 'text' : 'number'}
                step={field.step ?? (field.type === 'money' ? 0.01 : 1)}
                min={field.min}
                value={values[field.key] ?? ''}
                onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                required={field.required}
              />
            )}
            {field.hint ? <span className="field__hint">{field.hint}</span> : null}
          </label>
        ))}

        {error ? <ErrorNote message={error} /> : null}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Saving…' : item ? 'Save changes' : `Create ${spec.singular.toLowerCase()}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const activePill = (item: any) =>
  item.isActive ? <span className="pill pill--positive">Live</span> : <span className="pill">Off</span>;

export function Locations() {
  return (
    <ResourceManager
      spec={{
        path: 'locations',
        singular: 'Location',
        plural: 'Locations',
        icon: '📍',
        writeRole: 'manager',
        emptyBody: 'Your shops. Customers see these in the app, and sales are attributed to them.',
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true },
          { key: 'addressLine1', label: 'Street address', type: 'text' },
          { key: 'city', label: 'City', type: 'text' },
          { key: 'postcode', label: 'Postcode', type: 'text' },
          { key: 'phone', label: 'Phone', type: 'text' },
          { key: 'openingHours', label: 'Opening hours', type: 'text', hint: 'e.g. Mon–Sun 7:00–21:00' },
          { key: 'isActive', label: 'Show in the customer app', type: 'checkbox' },
        ],
        columns: [
          { label: 'Name', render: (item) => <span className="strong">{item.name}</span> },
          { label: 'Address', render: (item) => <span className="muted small">{[item.addressLine1, item.city].filter(Boolean).join(', ') || '—'}</span> },
          { label: 'Hours', render: (item) => <span className="muted small">{item.openingHours || '—'}</span> },
          { label: 'Status', render: activePill },
        ],
      }}
    />
  );
}

export function Products() {
  return (
    <ResourceManager
      spec={{
        path: 'products',
        singular: 'Product',
        plural: 'Products',
        icon: '☕',
        writeRole: 'manager',
        emptyBody: 'Your menu, as customers see it in the app.',
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'category', label: 'Category', type: 'text', defaultValue: 'Coffee' },
          { key: 'priceCents', label: 'Price', type: 'money', required: true },
          { key: 'isFeatured', label: 'Highlight as popular', type: 'checkbox', defaultValue: false },
          { key: 'isActive', label: 'Show in the customer app', type: 'checkbox' },
        ],
        columns: [
          { label: 'Product', render: (item) => (
            <div>
              <div className="strong">{item.name}</div>
              <div className="tiny muted truncate" style={{ maxWidth: 320 }}>{item.description}</div>
            </div>
          ) },
          { label: 'Category', render: (item) => <span className="pill">{item.category}</span> },
          { label: 'Price', align: 'right', render: (item, currency) => <span className="tabular">{formatMoney(item.priceCents, currency)}</span> },
          { label: 'Status', render: activePill },
        ],
      }}
    />
  );
}

export function Rewards() {
  return (
    <ResourceManager
      spec={{
        path: 'rewards',
        singular: 'Reward',
        plural: 'Rewards',
        icon: '🎁',
        writeRole: 'manager',
        emptyBody: 'What customers can spend their points on.',
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'pointsCost', label: 'Points cost', type: 'number', min: 1, required: true },
          { key: 'category', label: 'Category', type: 'text', defaultValue: 'Drinks' },
          { key: 'stock', label: 'Stock', type: 'number', min: -1, defaultValue: -1, hint: '-1 for unlimited' },
          { key: 'perMemberLimit', label: 'Limit per member', type: 'number', min: -1, defaultValue: -1, hint: '-1 for no limit' },
          { key: 'isActive', label: 'Available to redeem', type: 'checkbox' },
        ],
        columns: [
          { label: 'Reward', render: (item) => (
            <div>
              <div className="strong">{item.name}</div>
              <div className="tiny muted truncate" style={{ maxWidth: 320 }}>{item.description}</div>
            </div>
          ) },
          { label: 'Cost', align: 'right', render: (item) => <span className="tabular strong">{formatNumber(item.pointsCost)} pts</span> },
          { label: 'Stock', align: 'right', render: (item) => <span className="muted tabular">{item.stock < 0 ? 'Unlimited' : formatNumber(item.stock)}</span> },
          { label: 'Status', render: activePill },
        ],
      }}
    />
  );
}

export function Tiers() {
  return (
    <ResourceManager
      spec={{
        path: 'tiers',
        singular: 'Tier',
        plural: 'Tiers',
        icon: '🏅',
        writeRole: 'owner',
        emptyBody: 'Tiers reward your most loyal customers with a points multiplier and perks.',
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true },
          { key: 'minLifetimePoints', label: 'Lifetime points needed', type: 'number', min: 0, required: true },
          { key: 'multiplier', label: 'Points multiplier', type: 'number', min: 0.1, step: 0.05, defaultValue: 1, hint: '1.5 means they earn 50% more points.' },
          { key: 'color', label: 'Colour', type: 'color', defaultValue: '#94A3B8' },
          { key: 'perks', label: 'Perks (one per line)', type: 'list' },
        ],
        columns: [
          { label: 'Tier', render: (item) => (
            <span className="row" style={{ gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: item.color }} aria-hidden="true" />
              <span className="strong">{item.name}</span>
            </span>
          ) },
          { label: 'Reached at', align: 'right', render: (item) => <span className="tabular">{formatNumber(item.minLifetimePoints)} pts</span> },
          { label: 'Multiplier', align: 'right', render: (item) => <span className="tabular">{item.multiplier}x</span> },
          { label: 'Perks', render: (item) => <span className="muted small">{(item.perks ?? []).join(' · ') || '—'}</span> },
        ],
      }}
    />
  );
}

export function Campaigns() {
  return (
    <ResourceManager
      spec={{
        path: 'campaigns',
        singular: 'Campaign',
        plural: 'Campaigns',
        icon: '🎯',
        writeRole: 'manager',
        emptyBody: 'Time-boxed promotions. A multiplier doubles points; a bonus adds a flat amount.',
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true },
          { key: 'description', label: 'Description', type: 'textarea' },
          {
            key: 'type', label: 'Type', type: 'select', defaultValue: 'multiplier',
            options: [
              { value: 'multiplier', label: 'Multiply points' },
              { value: 'bonus', label: 'Add bonus points' },
            ],
          },
          { key: 'multiplier', label: 'Multiplier', type: 'number', min: 1, step: 0.1, defaultValue: 2 },
          { key: 'bonusPoints', label: 'Bonus points', type: 'number', min: 0, defaultValue: 0 },
          { key: 'minSpendCents', label: 'Minimum spend', type: 'money', defaultValue: '0' },
          { key: 'isActive', label: 'Running now', type: 'checkbox' },
        ],
        columns: [
          { label: 'Campaign', render: (item) => (
            <div>
              <div className="strong">{item.name}</div>
              <div className="tiny muted truncate" style={{ maxWidth: 300 }}>{item.description}</div>
            </div>
          ) },
          { label: 'Effect', render: (item) => (
            <span className="pill pill--info">
              {item.type === 'multiplier' ? `${item.multiplier}x points` : `+${formatNumber(item.bonusPoints)} pts`}
            </span>
          ) },
          { label: 'Min spend', align: 'right', render: (item, currency) => (
            <span className="tabular muted">{item.minSpendCents ? formatMoney(item.minSpendCents, currency) : '—'}</span>
          ) },
          { label: 'Status', render: activePill },
        ],
      }}
    />
  );
}
