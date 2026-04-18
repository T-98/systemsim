/**
 * @file components/nodes/SimComponentNode.tsx
 *
 * XyFlow custom node. Renders the component box: icon + label + description,
 * health-colored border, live metrics when sim is running (RPS, p99, error%,
 * CPU, MEM, queue, cache-hit), shard distribution bars for DBs, crash mark.
 *
 * Pulses when `pulseTarget === 'node:${id}'` or `pulseTarget === 'canvas:all'`.
 */

import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import type { SimComponentData, HealthState } from '../../types';
import { COMPONENT_DEFS } from '../../types/components';
import { ComponentIcon } from './icons';
import { useStore } from '../../store';
import InfoIcon from '../ui/InfoIcon';

function topicForComponentType(type: string): string {
  const camel = type.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return `component.${camel}`;
}

const healthBorderVar: Record<HealthState, string> = {
  healthy: 'var(--node-border)',
  warning: 'var(--node-border-warning)',
  critical: 'var(--node-border-critical)',
  crashed: 'var(--node-border-crashed)',
};

function SimComponentNode({ id, data, selected }: NodeProps & { data: SimComponentData }) {
  const simulationStatus = useStore((s) => s.simulationStatus);
  const liveMetrics = useStore((s) => s.liveMetrics[id]);
  const pulseTarget = useStore((s) => s.pulseTarget);
  const def = COMPONENT_DEFS[data.type];
  const health = data.health;
  const isRunning = simulationStatus === 'running' || simulationStatus === 'paused';

  const metrics = isRunning ? (liveMetrics ?? data.metrics) : null;
  const showShardDist = data.type === 'database' && metrics?.shardDistribution && metrics.shardDistribution.length > 1;
  const isPulsing = pulseTarget === `node:${id}` || pulseTarget === 'canvas:all';
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`relative min-w-[200px] cursor-pointer transition-all duration-200 ${isPulsing ? 'simfid-pulse' : ''}`}
      style={{
        borderRadius: '12px',
        border: `1px solid ${healthBorderVar[health]}`,
        background: 'var(--node-bg)',
        color: 'var(--text-primary)',
        boxShadow: 'var(--shadow-card)',
        opacity: health === 'crashed' ? 0.6 : 1,
        filter: health === 'crashed' ? 'grayscale(1)' : 'none',
        outline: selected ? '2px solid var(--accent)' : 'none',
        outlineOffset: selected ? '1px' : '0',
      }}
      animate={
        health === 'warning'
          ? { borderColor: ['var(--node-border-warning)', 'rgba(255,159,10,0.5)', 'var(--node-border-warning)'], transition: { repeat: Infinity, duration: 2 } }
          : health === 'critical'
          ? { borderColor: ['var(--node-border-critical)', 'rgba(255,59,48,0.5)', 'var(--node-border-critical)'], transition: { repeat: Infinity, duration: 0.8 } }
          : {}
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: '12px',
          height: '12px',
          background: 'var(--accent)',
          border: '2px solid var(--bg-primary)',
          borderRadius: '50%',
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: '12px',
          height: '12px',
          background: 'var(--accent)',
          border: '2px solid var(--bg-primary)',
          borderRadius: '50%',
        }}
      />

      <div className="flex items-center gap-2.5" style={{ padding: '12px 16px', borderLeft: `3px solid ${def.categoryColor}` }}>
        <div className="shrink-0" style={{ color: 'var(--text-tertiary)' }}>
          <ComponentIcon type={data.type} />
        </div>
        <div className="min-w-0">
          <div className="font-semibold truncate" style={{ fontSize: '14px', color: 'var(--text-primary)', letterSpacing: '-0.224px' }}>{data.label}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}>{def.description}</div>
        </div>
        {health === 'crashed' && (
          <div className="absolute font-bold" style={{ top: '6px', right: '8px', color: 'var(--destructive)', fontSize: '18px' }}>X</div>
        )}
        {hovered && health !== 'crashed' && (
          <div
            className="absolute"
            data-testid="node-info-badge"
            style={{ top: '6px', right: '8px' }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <InfoIcon topic={topicForComponentType(data.type)} side="bottom" />
          </div>
        )}
      </div>

      {isRunning && metrics && (
        <div
          className="space-y-0.5 tabular-nums"
          style={{
            padding: '0 16px 12px',
            fontSize: '12px',
            color: 'var(--text-tertiary)',
            fontFamily: "'Geist Mono', monospace",
            letterSpacing: '-0.12px',
          }}
        >
          <div className="flex justify-between">
            <span>RPS</span>
            <span style={{ color: 'var(--text-secondary)' }}>{Math.round(metrics.rps).toLocaleString()}</span>
          </div>
          {metrics.p99 > 0 && (
            <div className="flex justify-between">
              <span>p99</span>
              <span style={{ color: metrics.p99 > 500 ? 'var(--destructive)' : 'var(--text-secondary)' }}>{Math.round(metrics.p99)}ms</span>
            </div>
          )}
          {metrics.errorRate > 0 && (
            <div className="flex justify-between">
              <span>Err</span>
              <span style={{ color: 'var(--destructive)' }}>{(metrics.errorRate * 100).toFixed(1)}%</span>
            </div>
          )}
          {metrics.cpuPercent > 0 && (
            <div className="flex justify-between">
              <span>CPU</span>
              <span style={{ color: metrics.cpuPercent > 80 ? 'var(--destructive)' : metrics.cpuPercent > 50 ? 'var(--warning)' : 'var(--text-secondary)' }}>
                {Math.round(metrics.cpuPercent)}%
              </span>
            </div>
          )}
          {metrics.memoryPercent > 0 && (
            <div className="flex justify-between">
              <span>MEM</span>
              <span style={{ color: metrics.memoryPercent > 80 ? 'var(--destructive)' : 'var(--text-secondary)' }}>
                {Math.round(metrics.memoryPercent)}%
              </span>
            </div>
          )}
          {metrics.queueDepth !== undefined && metrics.queueDepth > 0 && (
            <div className="flex justify-between">
              <span>Depth</span>
              <span style={{ color: 'var(--warning)' }}>{metrics.queueDepth.toLocaleString()}</span>
            </div>
          )}
          {metrics.cacheHitRate !== undefined && (
            <div className="flex justify-between">
              <span>Hit</span>
              <span style={{ color: metrics.cacheHitRate < 0.5 ? 'var(--destructive)' : 'var(--success)' }}>
                {(metrics.cacheHitRate * 100).toFixed(0)}%
              </span>
            </div>
          )}
        </div>
      )}

      {showShardDist && (
        <div style={{ padding: '0 16px 12px' }}>
          <div className="flex gap-0.5 h-8 items-end">
            {metrics!.shardDistribution!.map((load, i) => {
              const maxLoad = Math.max(...metrics!.shardDistribution!);
              const pct = maxLoad > 0 ? (load / maxLoad) * 100 : 0;
              const isHot = load > maxLoad * 0.5 && maxLoad > 0;
              return (
                <div
                  key={i}
                  className="flex-1 rounded-t transition-all duration-200"
                  style={{
                    height: `${Math.max(pct, 5)}%`,
                    background: isHot ? 'var(--destructive)' : 'var(--success)',
                  }}
                  title={`Shard ${i}: ${Math.round(load)} ops/s`}
                />
              );
            })}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px', fontFamily: "'Geist Mono', monospace" }}>Shard distribution</div>
        </div>
      )}
    </motion.div>
  );
}

export default memo(SimComponentNode);
