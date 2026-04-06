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
      <div className="w-80 bg-[#0A0B12] border-l border-[#14161F] flex flex-col h-full overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#14161F]">
          <span className="text-xs font-semibold tracking-wide text-[#8890A8]">Wire Config</span>
          <button onClick={close} className="text-[#5A6078] hover:text-white text-sm transition-all duration-200">&times;</button>
        </div>
        <div className="p-5 space-y-5">
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
    <div className="w-80 bg-[#0A0B12] border-l border-[#14161F] flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#14161F]">
        <span className="text-xs font-semibold tracking-wide text-[#8890A8]">{def.label}</span>
        <button onClick={close} className="text-[#5A6078] hover:text-white text-sm transition-all duration-200">&times;</button>
      </div>
      <div className="p-5 space-y-5">
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
              <div key={key} className="text-[10px] text-[#5A6078]">
                <span className="text-[#8890A8]">{label}:</span> {value.length} items
              </div>
            );
          }
          return null;
        })}

        {!isRunning && (
          <button
            onClick={() => removeComponent(selectedNode.id)}
            className="w-full mt-4 px-4 py-2.5 text-xs text-red-400 border border-red-900/50 rounded-lg hover:bg-red-950/40 transition-all duration-200"
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
      <label className="block text-[11px] text-[#5A6078] mb-1.5 font-medium">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-[#0C0D14] text-[#B8BCC8] text-xs px-3 py-2.5 rounded-lg border border-[#14161F] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 disabled:opacity-40 transition-all duration-200 font-['Geist_Mono',monospace]"
      />
    </div>
  );
}

function ConfigToggle({ label, value, onChange, disabled }: {
  label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-[11px] text-[#5A6078] font-medium">{label}</label>
      <button
        onClick={() => !disabled && onChange(!value)}
        className={`w-9 h-5 rounded-full transition-all duration-200 ${value ? 'bg-blue-600' : 'bg-[#14161F]'} ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <div className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-all duration-200 ${value ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
      </button>
    </div>
  );
}

function ConfigSelect({ label, value, options, onChange, disabled }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] text-[#5A6078] mb-1.5 font-medium">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-[#0C0D14] text-[#B8BCC8] text-xs px-3 py-2.5 rounded-lg border border-[#14161F] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 disabled:opacity-40 transition-all duration-200"
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
