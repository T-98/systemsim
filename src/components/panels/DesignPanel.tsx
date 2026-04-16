import { useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useStore } from '../../store';
import type { ApiContract, AuthMode } from '../../types';

export default function DesignPanel() {
  const apiContracts = useStore((s) => s.apiContracts);
  const setApiContracts = useStore((s) => s.setApiContracts);
  const schemaInput = useStore((s) => s.schemaInput);
  const setSchemaInput = useStore((s) => s.setSchemaInput);
  const setSchemaMemory = useStore((s) => s.setSchemaMemory);
  const schemaMemory = useStore((s) => s.schemaMemory);
  const nodes = useStore((s) => s.nodes);
  const simulationStatus = useStore((s) => s.simulationStatus);
  const isRunning = simulationStatus === 'running' || simulationStatus === 'paused';

  const tab = useStore((s) => s.designPanelTab);
  const setTab = useStore((s) => s.setDesignPanelTab);

  const serviceNodes = nodes.filter(
    (n) => n.data.type === 'server' || n.data.type === 'api_gateway' || n.data.type === 'load_balancer',
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ padding: '12px' }}>
      <div className="flex gap-1 mb-3" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 8 }}>
        {(['api', 'schema'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '-0.12px',
              background: tab === t ? 'var(--bg-card-elevated)' : 'transparent',
              color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {t === 'api' ? 'Endpoints' : 'Schema'}
          </button>
        ))}
      </div>

      {tab === 'api' && (
        <ApiSection
          contracts={apiContracts}
          setContracts={setApiContracts}
          serviceNodes={serviceNodes}
          disabled={isRunning}
        />
      )}

      {tab === 'schema' && (
        <SchemaSection
          schemaInput={schemaInput}
          setSchemaInput={setSchemaInput}
          setSchemaMemory={setSchemaMemory}
          schemaMemory={schemaMemory}
          disabled={isRunning}
        />
      )}
    </div>
  );
}

function ApiSection({
  contracts,
  setContracts,
  serviceNodes,
  disabled,
}: {
  contracts: ApiContract[];
  setContracts: (c: ApiContract[]) => void;
  serviceNodes: { id: string; data: { label: string } }[];
  disabled: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ApiContract>({
    id: uuid(),
    method: 'GET',
    path: '',
    description: '',
    authMode: 'none',
    ownerServiceId: serviceNodes[0]?.id ?? null,
  });

  const save = () => {
    if (!draft.path) return;
    setContracts([...contracts, { ...draft, id: uuid() }]);
    setDraft({ id: uuid(), method: 'GET', path: '', description: '', authMode: 'none', ownerServiceId: serviceNodes[0]?.id ?? null });
    setAdding(false);
  };

  const grouped = new Map<string | null, ApiContract[]>();
  for (const c of contracts) {
    const key = c.ownerServiceId;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(c);
  }

  return (
    <div className="space-y-3">
      {serviceNodes.map((node) => {
        const owned = grouped.get(node.id) ?? [];
        return (
          <div key={node.id}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-tertiary)', letterSpacing: '-0.12px', marginBottom: 4 }}>
              {node.data.label}
            </div>
            {owned.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', opacity: 0.6, letterSpacing: '-0.12px' }}>
                No endpoints
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {owned.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1"
                    style={{
                      padding: '3px 6px',
                      borderRadius: 6,
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      fontSize: 12,
                      color: 'var(--text-primary)',
                      letterSpacing: '-0.12px',
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{c.method}</span> {c.path || '/'}
                    {!disabled && (
                      <button
                        onClick={() => setContracts(contracts.filter((x) => x.id !== c.id))}
                        style={{ fontSize: 12, color: 'var(--destructive)', marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        &times;
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {grouped.has(null) && (grouped.get(null)?.length ?? 0) > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--warning)', letterSpacing: '-0.12px', marginBottom: 4 }}>
            No owner service
          </div>
          <div className="flex flex-wrap gap-1">
            {grouped.get(null)!.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center"
                style={{
                  padding: '3px 6px',
                  borderRadius: 6,
                  background: 'rgba(255,159,10,0.08)',
                  border: '1px solid rgba(255,159,10,0.2)',
                  fontSize: 12,
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.12px',
                }}
              >
                <span style={{ fontWeight: 500 }}>{c.method}</span> {c.path || '/'}
              </span>
            ))}
          </div>
        </div>
      )}

      {!disabled && !adding && (
        <button
          onClick={() => setAdding(true)}
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            fontSize: 13,
            letterSpacing: '-0.224px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          + Add endpoint
        </button>
      )}

      {adding && (
        <div className="space-y-2" style={{ padding: '8px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex gap-1.5">
            <select
              value={draft.method}
              onChange={(e) => setDraft({ ...draft, method: e.target.value })}
              style={{ ...compactInput, width: 64 }}
            >
              <option>GET</option>
              <option>POST</option>
              <option>PUT</option>
              <option>DELETE</option>
            </select>
            <input
              placeholder="/path"
              value={draft.path}
              onChange={(e) => setDraft({ ...draft, path: e.target.value })}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setAdding(false); }}
              style={{ ...compactInput, flex: 1, fontFamily: "'Geist Mono', monospace" }}
            />
          </div>
          <div className="flex gap-1.5">
            <select
              value={draft.authMode}
              onChange={(e) => setDraft({ ...draft, authMode: e.target.value as AuthMode })}
              style={{ ...compactInput, width: 72 }}
            >
              <option value="none">None</option>
              <option value="jwt">JWT</option>
              <option value="oauth">OAuth</option>
            </select>
            <select
              value={draft.ownerServiceId ?? ''}
              onChange={(e) => setDraft({ ...draft, ownerServiceId: e.target.value || null })}
              style={{ ...compactInput, flex: 1 }}
            >
              <option value="">No owner</option>
              {serviceNodes.map((n) => (
                <option key={n.id} value={n.id}>{n.data.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-1.5 justify-end">
            <button
              onClick={() => setAdding(false)}
              style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!draft.path}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 12,
                background: draft.path ? 'var(--accent)' : 'var(--bg-card)',
                color: draft.path ? 'var(--text-on-accent)' : 'var(--text-tertiary)',
                border: 'none',
                cursor: draft.path ? 'pointer' : 'not-allowed',
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SchemaSection({
  schemaInput,
  setSchemaInput,
  setSchemaMemory,
  schemaMemory,
  disabled,
}: {
  schemaInput: string;
  setSchemaInput: (s: string) => void;
  setSchemaMemory: (s: import('../../types').SchemaMemoryBlock) => void;
  schemaMemory: import('../../types').SchemaMemoryBlock | null;
  disabled: boolean;
}) {
  const [text, setText] = useState(schemaInput);
  const [loading, setLoading] = useState(false);

  const parse = async () => {
    setSchemaInput(text);
    setLoading(true);
    try {
      const { parseSchemaLocally } = await import('./designFlowParser');
      const parsed = parseSchemaLocally(text);
      setSchemaMemory(parsed);
    } catch {
      setSchemaMemory({
        version: (useStore.getState().schemaHistory.length || 0) + 1,
        entities: [],
        relationships: [],
        aiNotes: 'Schema could not be parsed. Please refine your input.',
      });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        disabled={disabled}
        placeholder={`users table: id (bigint PK), name (text)\nnotifications table: id (bigint PK), user_id (bigint FK users.id)`}
        style={{
          width: '100%',
          background: 'var(--bg-input)',
          color: 'var(--text-secondary)',
          fontSize: 12,
          letterSpacing: '-0.12px',
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--border-color)',
          fontFamily: "'Geist Mono', monospace",
          resize: 'vertical',
        }}
      />
      {!disabled && (
        <button
          onClick={parse}
          disabled={loading || !text.trim()}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            fontSize: 12,
            letterSpacing: '-0.12px',
            background: text.trim() ? 'var(--accent)' : 'var(--bg-card)',
            color: text.trim() ? 'var(--text-on-accent)' : 'var(--text-tertiary)',
            border: 'none',
            cursor: text.trim() ? 'pointer' : 'not-allowed',
            width: '100%',
          }}
        >
          {loading ? 'Parsing...' : 'Parse & Save'}
        </button>
      )}
      {schemaMemory && schemaMemory.entities.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}>
          {schemaMemory.entities.length} table{schemaMemory.entities.length > 1 ? 's' : ''} parsed
          <div className="mt-1 space-y-0.5" style={{ fontFamily: "'Geist Mono', monospace" }}>
            {schemaMemory.entities.map((e) => (
              <div key={e.id}>{e.name} ({e.fields.length} fields{e.assignedDbId ? ', assigned' : ''})</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const compactInput: React.CSSProperties = {
  background: 'var(--bg-input)',
  color: 'var(--text-secondary)',
  fontSize: 12,
  letterSpacing: '-0.12px',
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border-color)',
};
