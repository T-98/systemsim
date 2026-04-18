/**
 * @file components/panels/ConfigPanel.tsx
 *
 * Right-dock config editor for the currently selected component. Opens
 * automatically when a node is clicked. Form fields are driven by the
 * component's type (different fields for server vs cache vs DB).
 *
 * Preflight routing lands here via `pulseTarget === 'node:${id}'` when the
 * user clicks an "Assign N tables" or similar config-level preflight item.
 */

import { useStore } from '../../store';
import { COMPONENT_DEFS } from '../../types/components';
import type { ApiContract } from '../../types';
import InfoIcon from '../ui/InfoIcon';

/** Map dynamic component config keys to topic registry keys. */
function topicForConfigKey(key: string): string {
  return `config.${key}`;
}

/** Map `ComponentType` (snake_case) to the component.* topic registry key. */
function topicForComponentType(type: string): string {
  const camel = type.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return `component.${camel}`;
}

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
          <ConfigField label="Throughput (RPS)" type="number" value={wireConfig.throughputRps} topic="config.throughputRps"
            onChange={(v) => updateWireConfig(selectedEdge.id, { throughputRps: Number(v) })} disabled={isRunning} />
          <ConfigField label="Latency (ms)" type="number" value={wireConfig.latencyMs} topic="config.latencyMs"
            onChange={(v) => updateWireConfig(selectedEdge.id, { latencyMs: Number(v) })} disabled={isRunning} />
          <ConfigField label="Jitter (ms)" type="number" value={wireConfig.jitterMs} topic="config.jitterMs"
            onChange={(v) => updateWireConfig(selectedEdge.id, { jitterMs: Number(v) })} disabled={isRunning} />

          <CircuitBreakerSection edgeId={selectedEdge.id} wireConfig={wireConfig} disabled={isRunning} />
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
        <div className="flex items-center gap-2">
          <span
            className="font-semibold tracking-wide"
            style={{ fontSize: '14px', color: 'var(--text-secondary)', letterSpacing: '-0.224px' }}
          >
            {def.label}
          </span>
          <InfoIcon topic={topicForComponentType(data.type)} side="bottom" />
        </div>
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
          const topic = topicForConfigKey(key);
          if (typeof value === 'boolean') {
            return (
              <ConfigToggle key={key} label={label} value={value} topic={topic}
                onChange={(v) => updateConfig(key, v)} disabled={isRunning} />
            );
          }
          if (typeof value === 'number') {
            return (
              <ConfigField key={key} label={label} type="number" value={value} topic={topic}
                onChange={(v) => updateConfig(key, Number(v))} disabled={isRunning} />
            );
          }
          if (typeof value === 'string') {
            const selectOptions = getSelectOptions(key);
            if (selectOptions) {
              return (
                <ConfigSelect key={key} label={label} value={value} options={selectOptions} topic={topic}
                  onChange={(v) => updateConfig(key, v)} disabled={isRunning} />
              );
            }
            return (
              <ConfigField key={key} label={label} type="text" value={value} topic={topic}
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

        {/* Entry point toggle */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={`entry-${selectedNode.id}`}
            checked={!!config.isEntry}
            onChange={(e) => updateConfig('isEntry', e.target.checked)}
            disabled={isRunning}
            style={{ accentColor: 'var(--accent)' }}
          />
          <label htmlFor={`entry-${selectedNode.id}`} style={{ fontSize: 14, color: 'var(--text-primary)', letterSpacing: '-0.224px' }}>
            This component receives external traffic
          </label>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', letterSpacing: '-0.12px', marginTop: -12 }}>
          Indicates incoming requests directly originating from the outside
        </div>

        {/* Endpoints section (server/api_gateway/load_balancer only) */}
        {(data.type === 'server' || data.type === 'api_gateway' || data.type === 'load_balancer') && (
          <EndpointsSection nodeId={selectedNode.id} disabled={isRunning} />
        )}

        {/* Assigned tables section (database only) */}
        {data.type === 'database' && (
          <AssignedTablesSection nodeId={selectedNode.id} disabled={isRunning} />
        )}

        {/* Retry policy — only for components that forward traffic downstream */}
        {canRetry(data.type) && (
          <RetryPolicySection nodeId={selectedNode.id} config={config} disabled={isRunning} />
        )}

        {/* Backpressure — only on component types whose processors emit errorRate */}
        {canBackpressure(data.type) && (
          <BackpressureSection nodeId={selectedNode.id} config={config} disabled={isRunning} />
        )}

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

function ConfigField({ label, type, value, onChange, disabled, topic }: {
  label: string; type: string; value: string | number; onChange: (v: string) => void; disabled?: boolean; topic?: string;
}) {
  return (
    <div>
      <div
        className="flex items-center gap-2"
        style={{ marginBottom: '6px' }}
      >
        <label
          className="block font-medium"
          style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}
        >
          {label}
        </label>
        {topic && <InfoIcon topic={topic} side="left" />}
      </div>
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

function ConfigToggle({ label, value, onChange, disabled, topic }: {
  label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; topic?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <label
          className="font-medium"
          style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}
        >
          {label}
        </label>
        {topic && <InfoIcon topic={topic} side="left" />}
      </div>
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

function ConfigSelect({ label, value, options, onChange, disabled, topic }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean; topic?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2" style={{ marginBottom: '6px' }}>
        <label
          className="block font-medium"
          style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}
        >
          {label}
        </label>
        {topic && <InfoIcon topic={topic} side="left" />}
      </div>
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

function EndpointsSection({ nodeId, disabled }: { nodeId: string; disabled: boolean }) {
  const apiContracts = useStore((s) => s.apiContracts);
  const owned = apiContracts.filter((c) => c.ownerServiceId === nodeId);

  return (
    <div>
      <h3
        style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.224px', marginBottom: 8 }}
      >
        Endpoints
      </h3>
      {owned.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', letterSpacing: '-0.224px' }}>
          No endpoints yet. Add one to define what this service handles.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {owned.map((c) => (
            <EndpointChip key={c.id} contract={c} disabled={disabled} />
          ))}
        </div>
      )}
    </div>
  );
}

function EndpointChip({ contract, disabled }: { contract: ApiContract; disabled: boolean }) {
  const setApiContracts = useStore((s) => s.setApiContracts);
  const apiContracts = useStore((s) => s.apiContracts);

  const handleRemove = () => {
    if (disabled) return;
    setApiContracts(apiContracts.filter((c) => c.id !== contract.id));
  };

  return (
    <span
      className="inline-flex items-center gap-1"
      style={{
        padding: '4px 8px',
        borderRadius: 6,
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        fontSize: 13,
        color: 'var(--text-primary)',
        letterSpacing: '-0.224px',
      }}
    >
      <span style={{ fontWeight: 500 }}>{contract.method}</span> {contract.path || '/'}
      {!disabled && (
        <button
          onClick={handleRemove}
          style={{ fontSize: 13, color: 'var(--destructive)', marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer' }}
          aria-label={`Remove ${contract.method} ${contract.path}`}
        >
          &times;
        </button>
      )}
    </span>
  );
}

function AssignedTablesSection({ nodeId, disabled }: { nodeId: string; disabled: boolean }) {
  const schemaMemory = useStore((s) => s.schemaMemory);
  const setSchemaMemory = useStore((s) => s.setSchemaMemory);

  if (!schemaMemory || schemaMemory.entities.length === 0) {
    return (
      <div>
        <h3
          style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.224px', marginBottom: 8 }}
        >
          Assigned Tables
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', letterSpacing: '-0.224px' }}>
          No schema entities yet. Define entities in Design → Schema.
        </p>
      </div>
    );
  }

  const assigned = schemaMemory.entities.filter((e) => e.assignedDbId === nodeId);
  const unassigned = schemaMemory.entities.filter((e) => !e.assignedDbId);

  const assignTable = (entityId: string) => {
    if (disabled) return;
    const updated = {
      ...schemaMemory,
      entities: schemaMemory.entities.map((e) =>
        e.id === entityId ? { ...e, assignedDbId: nodeId } : e,
      ),
    };
    setSchemaMemory(updated);
  };

  const unassignTable = (entityId: string) => {
    if (disabled) return;
    const updated = {
      ...schemaMemory,
      entities: schemaMemory.entities.map((e) =>
        e.id === entityId ? { ...e, assignedDbId: null } : e,
      ),
    };
    setSchemaMemory(updated);
  };

  return (
    <div>
      <h3
        style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.224px', marginBottom: 8 }}
      >
        Assigned Tables
      </h3>
      {assigned.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {assigned.map((e) => (
            <span
              key={e.id}
              className="inline-flex items-center gap-1"
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                fontSize: 13,
                color: 'var(--text-primary)',
                letterSpacing: '-0.224px',
              }}
            >
              {e.name}
              {!disabled && (
                <button
                  onClick={() => unassignTable(e.id)}
                  style={{ fontSize: 13, color: 'var(--destructive)', marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer' }}
                  aria-label={`Unassign ${e.name}`}
                >
                  &times;
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {unassigned.length > 0 && !disabled && (
        <select
          onChange={(e) => {
            if (e.target.value) assignTable(e.target.value);
            e.target.value = '';
          }}
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-input)',
            color: 'var(--text-secondary)',
            fontSize: 13,
            letterSpacing: '-0.224px',
          }}
        >
          <option value="">Assign a table...</option>
          {unassigned.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

/**
 * Phase 3 resilience: only components that forward traffic downstream can
 * sensibly retry (the retry policy governs outgoing calls). Pure leaves
 * like `external` or `autoscaler` never forward, so no retry UI for them.
 */
function canRetry(type: string): boolean {
  return type === 'server' || type === 'load_balancer' || type === 'api_gateway'
    || type === 'cache' || type === 'queue' || type === 'fanout' || type === 'cdn';
}

/**
 * Backpressure only makes sense on components whose processor actually sets
 * `state.metrics.errorRate`. Toggling it on a component that never emits
 * errorRate (fanout, websocket_gateway, cdn, autoscaler, cache) silently does
 * nothing — misleading. See Codex finding #4 on Phase 3 UI review.
 */
function canBackpressure(type: string): boolean {
  return type === 'server' || type === 'database' || type === 'queue'
    || type === 'api_gateway' || type === 'external' || type === 'load_balancer';
}

/**
 * Clamp a user-entered number to finite, non-NaN. Returns fallback for
 * Infinity/NaN/non-numeric input. Prevents engine-side silent rejection
 * (RetryPolicy.readRetryPolicy throws away Infinity and the UI never knew).
 */
function safeFiniteNumber(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Same as safeFiniteNumber but additionally enforces integer and a minimum
 * (e.g., maxRetries must be a positive integer).
 */
function safePositiveInt(raw: unknown, fallback: number, min = 1): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

/**
 * Clamp a number to [lo, hi] after finite check. For bounded params like
 * failureThreshold (0-1).
 */
function clampFinite(raw: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Collapsible wire-level circuit breaker config. Toggle enables/disables the
 * feature (adds/removes `wire.config.circuitBreaker`). Numeric fields let
 * the user tune failure detection + recovery. Preview: "CLOSED → OPEN
 * after N failed ticks, cooldown Xs, then M healthy probes → CLOSED."
 */
function CircuitBreakerSection({ edgeId, wireConfig, disabled }: {
  edgeId: string;
  wireConfig: { circuitBreaker?: {
    failureThreshold?: number; failureWindow?: number;
    cooldownSeconds?: number; halfOpenTicks?: number;
  } };
  disabled: boolean;
}) {
  const updateWireConfig = useStore((s) => s.updateWireConfig);
  const breaker = wireConfig.circuitBreaker;
  const enabled = !!breaker;

  const toggle = (on: boolean) => {
    if (disabled) return;
    if (on) {
      updateWireConfig(edgeId, {
        circuitBreaker: {
          failureThreshold: 0.5,
          failureWindow: 3,
          cooldownSeconds: 10,
          halfOpenTicks: 2,
        },
      });
    } else {
      updateWireConfig(edgeId, { circuitBreaker: undefined });
    }
  };

  const updateField = (key: string, value: number) => {
    if (disabled || !breaker) return;
    updateWireConfig(edgeId, {
      circuitBreaker: { ...breaker, [key]: value },
    });
  };

  return (
    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
      <ConfigToggle label="Circuit breaker" value={enabled} onChange={toggle} disabled={disabled} topic="config.circuitBreaker.enabled" />
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', letterSpacing: '-0.12px', marginTop: 6 }}>
        Fail-fast: drop traffic when downstream errors pile up.
      </div>
      {enabled && breaker && (
        <div className="space-y-4" style={{ marginTop: 14 }}>
          <ConfigField label="Failure threshold (errorRate 0–1)" type="number" value={breaker.failureThreshold ?? 0.5} topic="config.circuitBreaker.failureThreshold"
            onChange={(v) => updateField('failureThreshold', clampFinite(v, 0, 1, 0.5))} disabled={disabled} />
          <ConfigField label="Failure window (ticks)" type="number" value={breaker.failureWindow ?? 3} topic="config.circuitBreaker.failureWindow"
            onChange={(v) => updateField('failureWindow', safePositiveInt(v, 3, 1))} disabled={disabled} />
          <ConfigField label="Cooldown (seconds)" type="number" value={breaker.cooldownSeconds ?? 10} topic="config.circuitBreaker.cooldownSeconds"
            onChange={(v) => updateField('cooldownSeconds', Math.max(0, safeFiniteNumber(v, 10)))} disabled={disabled} />
          <ConfigField label="Half-open probe ticks" type="number" value={breaker.halfOpenTicks ?? 2} topic="config.circuitBreaker.halfOpenTicks"
            onChange={(v) => updateField('halfOpenTicks', safePositiveInt(v, 2, 1))} disabled={disabled} />
        </div>
      )}
    </div>
  );
}

/**
 * Retry policy config. Upstream components that forward traffic can opt in.
 * When downstream errorRate > 0, effective RPS is amplified by the geometric
 * sum of the retry waves (1 + e + e² + ...).
 */
function RetryPolicySection({ nodeId, config, disabled }: {
  nodeId: string;
  config: Record<string, unknown>;
  disabled: boolean;
}) {
  const updateComponentConfig = useStore((s) => s.updateComponentConfig);
  const policy = config.retryPolicy as { maxRetries?: number; backoffMs?: number; backoffMultiplier?: number } | undefined;
  const enabled = !!policy;

  const toggle = (on: boolean) => {
    if (disabled) return;
    if (on) {
      updateComponentConfig(nodeId, {
        retryPolicy: { maxRetries: 3, backoffMs: 100, backoffMultiplier: 2 },
      });
    } else {
      updateComponentConfig(nodeId, { retryPolicy: undefined });
    }
  };

  const updateField = (key: string, value: number) => {
    if (disabled || !policy) return;
    updateComponentConfig(nodeId, {
      retryPolicy: { ...policy, [key]: value },
    });
  };

  return (
    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
      <ConfigToggle label="Retry policy" value={enabled} onChange={toggle} disabled={disabled} topic="concept.retryStorm" />
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', letterSpacing: '-0.12px', marginTop: 6 }}>
        On downstream errors, this component retries — amplifies load.
      </div>
      {enabled && policy && (
        <div className="space-y-4" style={{ marginTop: 14 }}>
          <ConfigField label="Max retries" type="number" value={policy.maxRetries ?? 3} topic="config.retry.maxRetries"
            onChange={(v) => updateField('maxRetries', safePositiveInt(v, 3, 1))} disabled={disabled} />
          <ConfigField label="Backoff (ms, display-only)" type="number" value={policy.backoffMs ?? 100} topic="config.retry.backoffMs"
            onChange={(v) => updateField('backoffMs', Math.max(0, safeFiniteNumber(v, 100)))} disabled={disabled} />
          <ConfigField label="Backoff multiplier (display-only)" type="number" value={policy.backoffMultiplier ?? 2} topic="config.retry.backoffMs"
            onChange={(v) => updateField('backoffMultiplier', Math.max(0, safeFiniteNumber(v, 2)))} disabled={disabled} />
        </div>
      )}
    </div>
  );
}

/**
 * Backpressure opt-in. When enabled on a target, upstream callers scale
 * forwarded RPS down by the target's acceptanceRate (1 - errorRate)
 * observed in the previous tick.
 */
function BackpressureSection({ nodeId, config, disabled }: {
  nodeId: string;
  config: Record<string, unknown>;
  disabled: boolean;
}) {
  const updateComponentConfig = useStore((s) => s.updateComponentConfig);
  const bp = config.backpressure as { enabled?: boolean } | undefined;
  const enabled = bp?.enabled === true;

  const toggle = (on: boolean) => {
    if (disabled) return;
    if (on) updateComponentConfig(nodeId, { backpressure: { enabled: true } });
    else updateComponentConfig(nodeId, { backpressure: undefined });
  };

  return (
    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
      <ConfigToggle label="Backpressure" value={enabled} onChange={toggle} disabled={disabled} topic="config.backpressure.enabled" />
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', letterSpacing: '-0.12px', marginTop: 6 }}>
        Signal saturation to callers so they slow down proportionally.
      </div>
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
