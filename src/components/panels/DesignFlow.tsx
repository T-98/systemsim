import { useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useStore } from '../../store';
import type { NFR, ApiContract, AuthMode } from '../../types';
import { parseSchemaLocally } from './designFlowParser';

export default function DesignFlow({ onComplete }: { onComplete: () => void }) {
  const [activeSection, setActiveSection] = useState<string>('requirements');
  const functionalReqs = useStore((s) => s.functionalReqs);
  const nonFunctionalReqs = useStore((s) => s.nonFunctionalReqs);
  const apiContracts = useStore((s) => s.apiContracts);
  const schemaInput = useStore((s) => s.schemaInput);
  const setFunctionalReqs = useStore((s) => s.setFunctionalReqs);
  const setNonFunctionalReqs = useStore((s) => s.setNonFunctionalReqs);
  const setApiContracts = useStore((s) => s.setApiContracts);
  const setSchemaInput = useStore((s) => s.setSchemaInput);
  const setSchemaMemory = useStore((s) => s.setSchemaMemory);

  const [reqInput, setReqInput] = useState(functionalReqs.join('\n'));
  const [nfrList, setNfrList] = useState<NFR[]>(nonFunctionalReqs.length ? nonFunctionalReqs : [
    { attribute: '', target: '', scope: '' },
  ]);
  const [apiList, setApiList] = useState<ApiContract[]>(apiContracts.length ? apiContracts : [
    { id: uuid(), method: 'POST', path: '', description: '', authMode: 'none', ownerServiceId: null },
  ]);
  const [schemaText, setSchemaText] = useState(schemaInput);
  const [schemaLoading, setSchemaLoading] = useState(false);

  const sections = [
    { id: 'requirements', label: 'Requirements' },
    { id: 'api', label: 'API Contracts' },
    { id: 'schema', label: 'Data Model' },
  ];

  const saveRequirements = () => {
    const reqs = reqInput.split('\n').map((s) => s.trim()).filter(Boolean);
    setFunctionalReqs(reqs);
    const validNfrs = nfrList.filter((n) => n.attribute && n.target);
    setNonFunctionalReqs(validNfrs);
  };

  const saveApi = () => {
    const valid = apiList.filter((a) => a.path);
    setApiContracts(valid);
  };

  const saveSchema = async () => {
    setSchemaInput(schemaText);

    // Parse schema locally (simplified — in production this would call Anthropic API)
    setSchemaLoading(true);
    try {
      const parsed = parseSchemaLocally(schemaText);
      setSchemaMemory(parsed);
    } catch {
      // Fallback: just save raw
      setSchemaMemory({
        version: (useStore.getState().schemaHistory.length || 0) + 1,
        entities: [],
        relationships: [],
        aiNotes: 'Schema could not be parsed. Please refine your input.',
      });
    }
    setSchemaLoading(false);
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-input)',
    color: 'var(--text-secondary)',
    fontSize: '14px',
    letterSpacing: '-0.224px',
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
  };

  const textareaStyle: React.CSSProperties = {
    ...inputStyle,
    fontSize: '14px',
    padding: '12px 16px',
    fontFamily: "'Geist Mono', monospace",
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
      <div className="max-w-2xl mx-auto" style={{ padding: '40px 32px' }}>
        <h2
          className="font-semibold"
          style={{
            fontSize: '40px',
            letterSpacing: '-0.374px',
            color: 'var(--text-primary)',
            marginBottom: '12px',
          }}
        >
          Design Flow
        </h2>
        <p
          className="leading-relaxed"
          style={{
            fontSize: '17px',
            color: 'var(--text-tertiary)',
            letterSpacing: '-0.374px',
            marginBottom: '40px',
          }}
        >
          Complete each section to enrich the simulation. You can skip sections and come back — minimum viable input is a diagram.
        </p>

        {/* Scenario brief banner */}
        <div
          className="rounded-lg"
          style={{
            marginBottom: '32px',
            padding: '20px',
            background: 'var(--bg-card)',
          }}
        >
          <div
            className="uppercase font-medium"
            style={{ fontSize: '10px', letterSpacing: '0.2em', color: 'var(--text-tertiary)', marginBottom: '6px' }}
          >
            Scenario Brief
          </div>
          <p className="leading-relaxed" style={{ fontSize: '14px', color: 'var(--text-secondary)', letterSpacing: '-0.224px' }}>
            Design a system that handles @everyone mentions in a Discord-scale server with 500k+ members, fanning out notifications without degrading real-time chat.
          </p>
        </div>

        <div
          className="flex gap-1 rounded-lg"
          style={{ marginBottom: '32px', padding: '4px', background: 'var(--bg-card)' }}
        >
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className="flex-1 rounded-lg transition-all duration-200 font-medium"
              style={{
                padding: '10px 16px',
                fontSize: '14px',
                letterSpacing: '-0.224px',
                background: activeSection === s.id ? 'var(--bg-card-elevated)' : 'transparent',
                color: activeSection === s.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
                boxShadow: activeSection === s.id ? 'var(--shadow-card)' : 'none',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {activeSection === 'requirements' && (
          <div className="space-y-5">
            <div>
              <label
                className="block font-medium"
                style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '8px', letterSpacing: '-0.12px' }}
              >
                Functional Requirements (one per line)
              </label>
              <textarea
                value={reqInput}
                onChange={(e) => setReqInput(e.target.value)}
                rows={6}
                className="w-full transition-all duration-200"
                style={textareaStyle}
                placeholder="Handle @everyone mentions in servers with 500k+ members&#10;Fan out notifications to all members..."
              />
            </div>
            <div>
              <label
                className="block font-medium"
                style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '8px', letterSpacing: '-0.12px' }}
              >
                Non-Functional Requirements
              </label>
              {nfrList.map((nfr, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input
                    placeholder="Attribute"
                    value={nfr.attribute}
                    onChange={(e) => {
                      const copy = [...nfrList];
                      copy[i] = { ...copy[i], attribute: e.target.value };
                      setNfrList(copy);
                    }}
                    className="flex-1 transition-all duration-200"
                    style={inputStyle}
                  />
                  <input
                    placeholder="Target"
                    value={nfr.target}
                    onChange={(e) => {
                      const copy = [...nfrList];
                      copy[i] = { ...copy[i], target: e.target.value };
                      setNfrList(copy);
                    }}
                    className="flex-1 transition-all duration-200"
                    style={inputStyle}
                  />
                  <input
                    placeholder="Scope"
                    value={nfr.scope}
                    onChange={(e) => {
                      const copy = [...nfrList];
                      copy[i] = { ...copy[i], scope: e.target.value };
                      setNfrList(copy);
                    }}
                    className="flex-1 transition-all duration-200"
                    style={inputStyle}
                  />
                </div>
              ))}
              <button
                onClick={() => setNfrList([...nfrList, { attribute: '', target: '', scope: '' }])}
                className="transition-all duration-200"
                style={{ fontSize: '14px', color: 'var(--accent-link)', letterSpacing: '-0.224px' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--accent-link)'; }}
              >
                + Add NFR
              </button>
            </div>
            <button
              onClick={saveRequirements}
              className="rounded-lg font-medium transition-all duration-200"
              style={{
                padding: '10px 20px',
                fontSize: '14px',
                letterSpacing: '-0.224px',
                background: 'var(--accent)',
                color: 'var(--text-on-accent)',
              }}
            >
              Save Requirements
            </button>
          </div>
        )}

        {activeSection === 'api' && (
          <div className="space-y-5">
            <label
              className="block font-medium"
              style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '8px', letterSpacing: '-0.12px' }}
            >
              API Contracts
            </label>
            {apiList.map((api, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <select
                  value={api.method}
                  onChange={(e) => {
                    const copy = [...apiList];
                    copy[i] = { ...copy[i], method: e.target.value };
                    setApiList(copy);
                  }}
                  className="w-24 transition-all duration-200"
                  style={inputStyle}
                >
                  <option>GET</option>
                  <option>POST</option>
                  <option>PUT</option>
                  <option>DELETE</option>
                </select>
                <input
                  placeholder="/path"
                  value={api.path}
                  onChange={(e) => {
                    const copy = [...apiList];
                    copy[i] = { ...copy[i], path: e.target.value };
                    setApiList(copy);
                  }}
                  className="flex-1 transition-all duration-200"
                  style={{ ...inputStyle, fontFamily: "'Geist Mono', monospace" }}
                />
                <input
                  placeholder="Description"
                  value={api.description}
                  onChange={(e) => {
                    const copy = [...apiList];
                    copy[i] = { ...copy[i], description: e.target.value };
                    setApiList(copy);
                  }}
                  className="flex-1 transition-all duration-200"
                  style={inputStyle}
                />
                <select
                  value={api.authMode}
                  onChange={(e) => {
                    const copy = [...apiList];
                    copy[i] = { ...copy[i], authMode: e.target.value as AuthMode };
                    setApiList(copy);
                  }}
                  style={{ ...inputStyle, width: 80, fontSize: 12 }}
                >
                  <option value="none">None</option>
                  <option value="jwt">JWT</option>
                  <option value="oauth">OAuth</option>
                </select>
              </div>
            ))}
            <button
              onClick={() => setApiList([...apiList, { id: uuid(), method: 'GET', path: '', description: '', authMode: 'none', ownerServiceId: null }])}
              className="transition-all duration-200"
              style={{ fontSize: '14px', color: 'var(--accent-link)', letterSpacing: '-0.224px' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--accent-link)'; }}
            >
              + Add endpoint
            </button>
            <div>
              <button
                onClick={saveApi}
                className="rounded-lg font-medium transition-all duration-200"
                style={{
                  padding: '10px 20px',
                  fontSize: '14px',
                  letterSpacing: '-0.224px',
                  background: 'var(--accent)',
                  color: 'var(--text-on-accent)',
                }}
              >
                Save API Contracts
              </button>
            </div>
          </div>
        )}

        {activeSection === 'schema' && (
          <div className="space-y-5">
            <label
              className="block font-medium"
              style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '8px', letterSpacing: '-0.12px' }}
            >
              Data Model — write in any format (SQL, JSON, natural language, bullet points)
            </label>
            <textarea
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              rows={10}
              className="w-full transition-all duration-200"
              style={textareaStyle}
              placeholder={`users table: id (bigint PK), name (text)
notifications table: id (bigint PK), user_id (bigint FK users.id), content (text), created_at (timestamp)
  - partition key: user_id
  - index on created_at (btree)
  - access: heavy writes per notification event, reads for inbox`}
            />
            <button
              onClick={saveSchema}
              disabled={schemaLoading}
              className="rounded-lg font-medium disabled:opacity-50 transition-all duration-200"
              style={{
                padding: '10px 20px',
                fontSize: '14px',
                letterSpacing: '-0.224px',
                background: 'var(--accent)',
                color: 'var(--text-on-accent)',
              }}
            >
              {schemaLoading ? 'Parsing...' : 'Parse & Save Schema'}
            </button>
            {useStore.getState().schemaMemory && (
              <SchemaPreview />
            )}
          </div>
        )}

        <div className="flex justify-end" style={{ marginTop: '40px' }}>
          <button
            onClick={onComplete}
            className="rounded-lg font-medium transition-all duration-200"
            style={{
              padding: '12px 32px',
              fontSize: '17px',
              letterSpacing: '-0.374px',
              background: 'var(--accent)',
              color: 'var(--text-on-accent)',
            }}
          >
            Continue to Canvas
          </button>
        </div>
      </div>
    </div>
  );
}

function SchemaPreview() {
  const schema = useStore((s) => s.schemaMemory);
  if (!schema) return null;

  return (
    <div
      className="rounded-lg"
      style={{
        marginTop: '20px',
        padding: '20px',
        background: 'var(--bg-card)',
      }}
    >
      <div
        className="font-medium"
        style={{ fontSize: '14px', color: 'var(--text-tertiary)', marginBottom: '12px', letterSpacing: '-0.224px' }}
      >
        Parsed Schema (v{schema.version})
      </div>
      {schema.entities.map((entity) => (
        <div key={entity.name} className="mb-4">
          <div className="font-semibold" style={{ fontSize: '14px', color: 'var(--text-secondary)', letterSpacing: '-0.224px' }}>{entity.name}</div>
          <div
            className="space-y-0.5"
            style={{
              marginLeft: '12px',
              marginTop: '4px',
              fontSize: '12px',
              color: 'var(--text-tertiary)',
              fontFamily: "'Geist Mono', monospace",
              letterSpacing: '-0.12px',
            }}
          >
            {entity.fields.map((f) => (
              <div key={f.name}>
                {f.name}: {f.type} [{f.cardinality}] {f.notes ? `\u2014 ${f.notes}` : ''}
              </div>
            ))}
            {entity.partitionKey && (
              <div
                style={{
                  marginTop: '6px',
                  color: entity.partitionKeyCardinalityWarning ? 'var(--warning)' : 'var(--text-secondary)',
                }}
              >
                Partition key: {entity.partitionKey}
                {entity.partitionKeyCardinalityWarning && ' (cardinality warning)'}
              </div>
            )}
          </div>
        </div>
      ))}
      {schema.aiNotes && (
        <div
          style={{
            fontSize: '12px',
            color: 'var(--warning)',
            marginTop: '12px',
            paddingTop: '12px',
            borderTop: '1px solid var(--border-color)',
            letterSpacing: '-0.12px',
          }}
        >
          {schema.aiNotes}
        </div>
      )}
    </div>
  );
}

