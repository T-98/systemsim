import { useState } from 'react';
import { useStore } from '../../store';
import type { NFR, ApiContract } from '../../types';

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
    { method: 'POST', path: '', description: '', auth: true },
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

  return (
    <div className="bg-[#0F1117] min-h-screen text-white">
      <div className="max-w-3xl mx-auto py-8 px-4">
        <h2 className="text-lg font-semibold mb-6">Design Flow</h2>
        <p className="text-sm text-gray-400 mb-8">
          Complete each section to enrich the simulation. You can skip sections and come back — minimum viable input is a diagram.
        </p>

        <div className="flex gap-2 mb-6">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`px-3 py-1.5 text-xs rounded-sm transition-colors ${
                activeSection === s.id ? 'bg-blue-600 text-white' : 'bg-[#1A1D27] text-gray-400 hover:text-gray-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {activeSection === 'requirements' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-2">Functional Requirements (one per line)</label>
              <textarea
                value={reqInput}
                onChange={(e) => setReqInput(e.target.value)}
                rows={6}
                className="w-full bg-[#1A1D27] text-gray-300 text-sm px-3 py-2 rounded-sm border border-[#2A2D3A] focus:border-blue-500 focus:outline-none font-mono"
                placeholder="Handle @everyone mentions in servers with 500k+ members&#10;Fan out notifications to all members..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-2">Non-Functional Requirements</label>
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
                    className="flex-1 bg-[#1A1D27] text-gray-300 text-xs px-2 py-1.5 rounded-sm border border-[#2A2D3A] focus:border-blue-500 focus:outline-none"
                  />
                  <input
                    placeholder="Target"
                    value={nfr.target}
                    onChange={(e) => {
                      const copy = [...nfrList];
                      copy[i] = { ...copy[i], target: e.target.value };
                      setNfrList(copy);
                    }}
                    className="flex-1 bg-[#1A1D27] text-gray-300 text-xs px-2 py-1.5 rounded-sm border border-[#2A2D3A] focus:border-blue-500 focus:outline-none"
                  />
                  <input
                    placeholder="Scope"
                    value={nfr.scope}
                    onChange={(e) => {
                      const copy = [...nfrList];
                      copy[i] = { ...copy[i], scope: e.target.value };
                      setNfrList(copy);
                    }}
                    className="flex-1 bg-[#1A1D27] text-gray-300 text-xs px-2 py-1.5 rounded-sm border border-[#2A2D3A] focus:border-blue-500 focus:outline-none"
                  />
                </div>
              ))}
              <button
                onClick={() => setNfrList([...nfrList, { attribute: '', target: '', scope: '' }])}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                + Add NFR
              </button>
            </div>
            <button onClick={saveRequirements} className="px-4 py-2 text-xs bg-blue-600 hover:bg-blue-500 rounded-sm">
              Save Requirements
            </button>
          </div>
        )}

        {activeSection === 'api' && (
          <div className="space-y-4">
            <label className="block text-xs text-gray-400 mb-2">API Contracts</label>
            {apiList.map((api, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <select
                  value={api.method}
                  onChange={(e) => {
                    const copy = [...apiList];
                    copy[i] = { ...copy[i], method: e.target.value };
                    setApiList(copy);
                  }}
                  className="w-24 bg-[#1A1D27] text-gray-300 text-xs px-2 py-1.5 rounded-sm border border-[#2A2D3A] focus:border-blue-500 focus:outline-none"
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
                  className="flex-1 bg-[#1A1D27] text-gray-300 text-xs px-2 py-1.5 rounded-sm border border-[#2A2D3A] focus:border-blue-500 focus:outline-none font-mono"
                />
                <input
                  placeholder="Description"
                  value={api.description}
                  onChange={(e) => {
                    const copy = [...apiList];
                    copy[i] = { ...copy[i], description: e.target.value };
                    setApiList(copy);
                  }}
                  className="flex-1 bg-[#1A1D27] text-gray-300 text-xs px-2 py-1.5 rounded-sm border border-[#2A2D3A] focus:border-blue-500 focus:outline-none"
                />
                <label className="flex items-center gap-1 text-[10px] text-gray-500">
                  <input
                    type="checkbox"
                    checked={api.auth}
                    onChange={(e) => {
                      const copy = [...apiList];
                      copy[i] = { ...copy[i], auth: e.target.checked };
                      setApiList(copy);
                    }}
                    className="rounded-sm"
                  />
                  Auth
                </label>
              </div>
            ))}
            <button
              onClick={() => setApiList([...apiList, { method: 'GET', path: '', description: '', auth: true }])}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              + Add endpoint
            </button>
            <div>
              <button onClick={saveApi} className="px-4 py-2 text-xs bg-blue-600 hover:bg-blue-500 rounded-sm">
                Save API Contracts
              </button>
            </div>
          </div>
        )}

        {activeSection === 'schema' && (
          <div className="space-y-4">
            <label className="block text-xs text-gray-400 mb-2">
              Data Model — write in any format (SQL, JSON, natural language, bullet points)
            </label>
            <textarea
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              rows={10}
              className="w-full bg-[#1A1D27] text-gray-300 text-sm px-3 py-2 rounded-sm border border-[#2A2D3A] focus:border-blue-500 focus:outline-none font-mono"
              placeholder={`users table: id (bigint PK), name (text)
notifications table: id (bigint PK), user_id (bigint FK users.id), content (text), created_at (timestamp)
  - partition key: user_id
  - index on created_at (btree)
  - access: heavy writes per notification event, reads for inbox`}
            />
            <button
              onClick={saveSchema}
              disabled={schemaLoading}
              className="px-4 py-2 text-xs bg-blue-600 hover:bg-blue-500 rounded-sm disabled:opacity-50"
            >
              {schemaLoading ? 'Parsing...' : 'Parse & Save Schema'}
            </button>
            {useStore.getState().schemaMemory && (
              <SchemaPreview />
            )}
          </div>
        )}

        <div className="mt-8 flex justify-end">
          <button
            onClick={onComplete}
            className="px-6 py-2.5 text-sm bg-blue-600 hover:bg-blue-500 rounded-sm font-medium"
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
    <div className="mt-4 p-3 bg-[#1A1D27] rounded-sm border border-[#2A2D3A]">
      <div className="text-xs text-gray-400 mb-2">Parsed Schema (v{schema.version})</div>
      {schema.entities.map((entity) => (
        <div key={entity.name} className="mb-3">
          <div className="text-xs font-semibold text-gray-300">{entity.name}</div>
          <div className="ml-2 text-[10px] text-gray-500 font-mono">
            {entity.fields.map((f) => (
              <div key={f.name}>
                {f.name}: {f.type} [{f.cardinality}] {f.notes ? `— ${f.notes}` : ''}
              </div>
            ))}
            {entity.partitionKey && (
              <div className={`mt-1 ${entity.partitionKeyCardinalityWarning ? 'text-amber-400' : 'text-gray-400'}`}>
                Partition key: {entity.partitionKey}
                {entity.partitionKeyCardinalityWarning && ' (cardinality warning)'}
              </div>
            )}
          </div>
        </div>
      ))}
      {schema.aiNotes && (
        <div className="text-[10px] text-amber-400/80 mt-2 border-t border-[#2A2D3A] pt-2">{schema.aiNotes}</div>
      )}
    </div>
  );
}

function parseSchemaLocally(input: string): import('../../types').SchemaMemoryBlock {
  const version = (useStore.getState().schemaHistory.length || 0) + 1;
  const entities: import('../../types').SchemaEntity[] = [];
  const relationships: import('../../types').SchemaRelationship[] = [];

  const lines = input.split('\n').map((l) => l.trim()).filter(Boolean);
  let currentEntity: import('../../types').SchemaEntity | null = null;

  for (const line of lines) {
    const tableMatch = line.match(/^(\w+)\s+table\s*:/i) || line.match(/^CREATE\s+TABLE\s+(\w+)/i);
    if (tableMatch) {
      if (currentEntity) entities.push(currentEntity);
      currentEntity = { name: tableMatch[1], fields: [], indexes: [], accessPatterns: [] };

      // Parse inline fields
      const fieldPart = line.split(':').slice(1).join(':');
      if (fieldPart) {
        const fieldStrs = fieldPart.split(',');
        for (const fs of fieldStrs) {
          const parts = fs.trim().split(/\s+/);
          if (parts.length >= 1) {
            const name = parts[0].replace(/[()]/g, '');
            const type = parts[1]?.replace(/[()]/g, '') ?? 'text';
            const isFk = fs.toLowerCase().includes('fk');
            const isPk = fs.toLowerCase().includes('pk');
            const cardinality: 'low' | 'medium' | 'high' = isPk ? 'high' : isFk ? 'medium' : 'high';

            if (name && name.length > 0) {
              currentEntity.fields.push({
                name,
                type,
                cardinality,
                notes: isPk ? 'primary key' : isFk ? `foreign key${fs.match(/FK\s+(\S+)/i)?.[1] ? ` to ${fs.match(/FK\s+(\S+)/i)![1]}` : ''}` : undefined,
              });

              if (isFk) {
                const fkTarget = fs.match(/FK\s+(\w+)\.(\w+)/i);
                if (fkTarget) {
                  relationships.push({
                    from: `${currentEntity.name}.${name}`,
                    to: `${fkTarget[1]}.${fkTarget[2]}`,
                    type: 'many_to_one',
                  });
                }
              }
            }
          }
        }
      }
      continue;
    }

    if (currentEntity) {
      const partitionMatch = line.match(/partition\s+key\s*:\s*(\w+)/i);
      if (partitionMatch) {
        currentEntity.partitionKey = partitionMatch[1];
        // Check if partition key is user_id — medium cardinality warning
        if (partitionMatch[1].toLowerCase().includes('user')) {
          currentEntity.partitionKeyCardinalityWarning = true;
          const field = currentEntity.fields.find((f) => f.name === partitionMatch[1]);
          if (field) field.cardinality = 'medium';
        }
        continue;
      }

      const indexMatch = line.match(/index\s+on\s+(\w+)\s*\((\w+)\)/i) || line.match(/index\s+on\s+(\w+)/i);
      if (indexMatch) {
        currentEntity.indexes.push({
          field: indexMatch[1],
          type: (indexMatch[2] as 'btree' | 'hash') ?? 'btree',
        });
        continue;
      }

      const accessMatch = line.match(/access\s*:\s*(.+)/i);
      if (accessMatch) {
        const desc = accessMatch[1];
        if (desc.toLowerCase().includes('write')) {
          currentEntity.accessPatterns.push({ operation: 'write', frequency: 'very_high', pattern: desc });
        }
        if (desc.toLowerCase().includes('read')) {
          currentEntity.accessPatterns.push({ operation: 'read', frequency: 'high', pattern: desc });
        }
        continue;
      }
    }
  }

  if (currentEntity) entities.push(currentEntity);

  // Generate AI notes
  let aiNotes = '';
  for (const entity of entities) {
    if (entity.partitionKeyCardinalityWarning) {
      aiNotes += `Partition key ${entity.partitionKey} on ${entity.name} has medium cardinality. In a notification system with large server memberships, this concentrates writes for active users on their shard.`;
    }
  }

  return { version, entities, relationships, aiNotes };
}
