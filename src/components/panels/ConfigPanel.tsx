import { useStore } from '../../store';
import { COMPONENT_DEFS } from '../../types/components';

export default function ConfigPanel() {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const configPanelOpen = useStore((s) => s.configPanelOpen);
  const setConfigPanelOpen = useStore((s) => s.setConfigPanelOpen);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const updateComponentConfig = useStore((s) => s.updateComponentConfig);
  const updateComponentLabel = useStore((s) => s.updateComponentLabel);
  const updateWireConfig = useStore((s) => s.updateWireConfig);
  const removeComponent = useStore((s) => s.removeComponent);
  const simulationStatus = useStore((s) => s.simulationStatus);
  const isRunning = simulationStatus === 'running' || simulationStatus === 'paused';

  if (!configPanelOpen) return null;

  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;
  const selectedEdge = selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) : null;

  if (!selectedNode && !selectedEdge) return null;

  const close = () => setConfigPanelOpen(false);

  if (selectedEdge) {
    const wireConfig = selectedEdge.data!.config;
    return (
      <div
        className="w-80 flex flex-col h-full overflow-y-auto"
        style={{
          background: 'var(--bg-sidebar)',
          borderLeft: '1px solid var(--border-color)',
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}
        >
          <span
            className="font-semibold tracking-wide"
            style={{ fontSize: '14px', color: 'var(--text-secondary)', letterSpacing: '-0.224px' }}
          >
            Wire Config
          </span>
          <button
            onClick={close}
            className="transition-all duration-200"
            style={{ fontSize: '17px', color: 'var(--text-tertiary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            &times;
          </button>
        </div>
        <div style={{ padding: '20px' }} className="space-y-5">
          <ConfigField label="Throughput (RPS)" type="number" value={wireConfig.throughputRps}
            onChange={(v) => updateWireConfig(selectedEdge.id, { throughputRps: Number(v) })} disabled={isRunning} />
          <ConfigField label="Latency (ms)" type="number" value={wireConfig.latencyMs}
            onChange={(v) => updateWireConfig(selectedEdge.id, { latencyMs: Number(v) })} disabled={isRunning} />
          <ConfigField label="Jitter (ms)" type="number" value={wireConfig.jitterMs}
            onChange={(v) => updateWireConfig(selectedEdge.id, { jitterMs: Number(v) })} disabled={isRunning} />
        </div>
      </div>
    );
  }

  if (!selectedNode) return null;

  const { data } = selectedNode;
  const def = COMPONENT_DEFS[data.type];
  const config = data.config;

  const updateConfig = (key: string, value: unknown) => {
    updateComponentConfig(selectedNode.id, { [key]: value });
  };

  return (
    <div
      className="w-80 flex flex-col h-full overflow-y-auto"
      style={{
        background: 'var(--bg-sidebar)',
        borderLeft: '1px solid var(--border-color)',
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}
      >
        <span
          className="font-semibold tracking-wide"
          style={{ fontSize: '14px', color: 'var(--text-secondary)', letterSpacing: '-0.224px' }}
        >
          {def.label}
        </span>
        <button
          onClick={close}
          className="transition-all duration-200"
          style={{ fontSize: '17px', color: 'var(--text-tertiary)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
        >
          &times;
        </button>
      </div>
      <div style={{ padding: '20px' }} className="space-y-5">
        <ConfigField label="Label" type="text" value={data.label}
          onChange={(v) => updateComponentLabel(selectedNode.id, String(v))} disabled={isRunning} />

        {Object.entries(config).map(([key, value]) => {
          const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).replace(/_/g, ' ');
          if (typeof value === 'boolean') {
            return (
              <ConfigToggle key={key} label={label} value={value}
                onChange={(v) => updateConfig(key, v)} disabled={isRunning} />
            );
          }
          if (typeof value === 'number') {
            return (
              <ConfigField key={key} label={label} type="number" value={value}
                onChange={(v) => updateConfig(key, Number(v))} disabled={isRunning} />
            );
          }
          if (typeof value === 'string') {
            const selectOptions = getSelectOptions(key);
            if (selectOptions) {
              return (
                <ConfigSelect key={key} label={label} value={value} options={selectOptions}
                  onChange={(v) => updateConfig(key, v)} disabled={isRunning} />
              );
            }
            return (
              <ConfigField key={key} label={label} type="text" value={value}
                onChange={(v) => updateConfig(key, String(v))} disabled={isRunning} />
            );
          }
          if (Array.isArray(value)) {
            return (
              <div key={key} style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{label}:</span> {value.length} items
              </div>
            );
          }
          return null;
        })}

        {!isRunning && (
          <button
            onClick={() => removeComponent(selectedNode.id)}
            className="w-full rounded-lg transition-all duration-200"
            style={{
              marginTop: '16px',
              padding: '10px 16px',
              fontSize: '14px',
              letterSpacing: '-0.224px',
              color: 'var(--destructive)',
              border: '1px solid var(--destructive)',
              opacity: 0.7,
              background: 'transparent',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; }}
          >
            Delete Component
          </button>
        )}
      </div>
    </div>
  );
}

function ConfigField({ label, type, value, onChange, disabled }: {
  label: string; type: string; value: string | number; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div>
      <label
        className="block font-medium"
        style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '6px', letterSpacing: '-0.12px' }}
      >
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full disabled:opacity-40 transition-all duration-200"
        style={{
          background: 'var(--bg-input)',
          color: 'var(--text-secondary)',
          fontSize: '14px',
          letterSpacing: '-0.224px',
          padding: '10px 14px',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          fontFamily: "'Geist Mono', monospace",
        }}
      />
    </div>
  );
}

function ConfigToggle({ label, value, onChange, disabled }: {
  label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <label
        className="font-medium"
        style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}
      >
        {label}
      </label>
      <button
        onClick={() => !disabled && onChange(!value)}
        className="w-9 h-5 rounded-full transition-all duration-200"
        style={{
          background: value ? 'var(--accent)' : 'var(--border-color)',
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <div
          className="w-3.5 h-3.5 rounded-full shadow-sm transition-all duration-200"
          style={{
            background: '#ffffff',
            transform: value ? 'translateX(18px)' : 'translateX(3px)',
          }}
        />
      </button>
    </div>
  );
}

function ConfigSelect({ label, value, options, onChange, disabled }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div>
      <label
        className="block font-medium"
        style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '6px', letterSpacing: '-0.12px' }}
      >
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full disabled:opacity-40 transition-all duration-200"
        style={{
          background: 'var(--bg-input)',
          color: 'var(--text-secondary)',
          fontSize: '14px',
          letterSpacing: '-0.224px',
          padding: '10px 14px',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
        }}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

function getSelectOptions(key: string): string[] | null {
  const optionMap: Record<string, string[]> = {
    algorithm: ['round-robin', 'least-connections', 'weighted', 'ip-hash'],
    authMiddleware: ['none', 'jwt', 'api-key'],
    cpuProfile: ['low', 'medium', 'high'],
    memoryProfile: ['low', 'medium', 'high'],
    evictionPolicy: ['lru', 'lfu', 'ttl-only'],
    writeStrategy: ['write-through', 'write-back', 'write-around'],
    engine: ['postgres', 'cassandra', 'redis'],
    consistencyModel: ['strong', 'eventual', 'causal'],
    deliveryMode: ['parallel', 'sequential'],
  };
  return optionMap[key] ?? null;
}
