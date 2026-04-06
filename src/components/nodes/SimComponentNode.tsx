import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import type { SimComponentData, HealthState } from '../../types';
import { COMPONENT_DEFS } from '../../types/components';
import { ComponentIcon } from './icons';
import { useStore } from '../../store';

const healthBorder: Record<HealthState, string> = {
  healthy: 'border-[#2A2D3A]',
  warning: 'border-amber-500',
  critical: 'border-red-500',
  crashed: 'border-red-900',
};

const healthBg: Record<HealthState, string> = {
  healthy: 'bg-[#1E2235]',
  warning: 'bg-[#1E2235]',
  critical: 'bg-[#1E2235]',
  crashed: 'bg-[#15121A] opacity-60',
};

function SimComponentNode({ id, data, selected }: NodeProps & { data: SimComponentData }) {
  const simulationStatus = useStore((s) => s.simulationStatus);
  const liveMetrics = useStore((s) => s.liveMetrics[id]);
  const def = COMPONENT_DEFS[data.type];
  const health = data.health;
  const isRunning = simulationStatus === 'running' || simulationStatus === 'paused';

  const metrics = isRunning ? (liveMetrics ?? data.metrics) : null;
  const showShardDist = data.type === 'database' && metrics?.shardDistribution && metrics.shardDistribution.length > 1;

  return (
    <motion.div
      className={`
        relative min-w-[160px] rounded-sm border-2 ${healthBorder[health]} ${healthBg[health]}
        text-white shadow-lg cursor-pointer transition-colors
        ${selected ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-[#0F1117]' : ''}
        ${health === 'crashed' ? 'grayscale' : ''}
      `}
      animate={
        health === 'warning'
          ? { borderColor: ['#F59E0B', '#F59E0B80', '#F59E0B'], transition: { repeat: Infinity, duration: 2 } }
          : health === 'critical'
          ? { borderColor: ['#EF4444', '#EF444480', '#EF4444'], transition: { repeat: Infinity, duration: 0.8 } }
          : {}
      }
    >
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-[#3B82F6] !border-[#0F1117] !border-2" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-[#3B82F6] !border-[#0F1117] !border-2" />

      <div className="flex items-center gap-2 px-3 py-2" style={{ borderLeft: `3px solid ${def.categoryColor}` }}>
        <div className="text-gray-300 shrink-0">
          <ComponentIcon type={data.type} />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold truncate">{data.label}</div>
          <div className="text-[10px] text-gray-500">{def.description}</div>
        </div>
        {health === 'crashed' && (
          <div className="absolute top-1 right-1 text-red-500 text-lg font-bold">X</div>
        )}
      </div>

      {isRunning && metrics && (
        <div className="px-3 pb-2 text-[10px] text-gray-400 space-y-0.5 font-mono">
          <div className="flex justify-between">
            <span>RPS</span>
            <span className="text-gray-300">{Math.round(metrics.rps).toLocaleString()}</span>
          </div>
          {metrics.p99 > 0 && (
            <div className="flex justify-between">
              <span>p99</span>
              <span className={metrics.p99 > 500 ? 'text-red-400' : 'text-gray-300'}>{Math.round(metrics.p99)}ms</span>
            </div>
          )}
          {metrics.errorRate > 0 && (
            <div className="flex justify-between">
              <span>Err</span>
              <span className="text-red-400">{(metrics.errorRate * 100).toFixed(1)}%</span>
            </div>
          )}
          {metrics.cpuPercent > 0 && (
            <div className="flex justify-between">
              <span>CPU</span>
              <span className={metrics.cpuPercent > 80 ? 'text-red-400' : metrics.cpuPercent > 50 ? 'text-amber-400' : 'text-gray-300'}>
                {Math.round(metrics.cpuPercent)}%
              </span>
            </div>
          )}
          {metrics.memoryPercent > 0 && (
            <div className="flex justify-between">
              <span>MEM</span>
              <span className={metrics.memoryPercent > 80 ? 'text-red-400' : 'text-gray-300'}>
                {Math.round(metrics.memoryPercent)}%
              </span>
            </div>
          )}
          {metrics.queueDepth !== undefined && metrics.queueDepth > 0 && (
            <div className="flex justify-between">
              <span>Depth</span>
              <span className="text-amber-400">{metrics.queueDepth.toLocaleString()}</span>
            </div>
          )}
          {metrics.cacheHitRate !== undefined && (
            <div className="flex justify-between">
              <span>Hit</span>
              <span className={metrics.cacheHitRate < 0.5 ? 'text-red-400' : 'text-green-400'}>
                {(metrics.cacheHitRate * 100).toFixed(0)}%
              </span>
            </div>
          )}
        </div>
      )}

      {showShardDist && (
        <div className="px-3 pb-2">
          <div className="flex gap-0.5 h-8 items-end">
            {metrics!.shardDistribution!.map((load, i) => {
              const maxLoad = Math.max(...metrics!.shardDistribution!);
              const pct = maxLoad > 0 ? (load / maxLoad) * 100 : 0;
              const isHot = load > maxLoad * 0.5 && maxLoad > 0;
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-t-sm transition-all ${isHot ? 'bg-red-500' : 'bg-emerald-500'}`}
                  style={{ height: `${Math.max(pct, 5)}%` }}
                  title={`Shard ${i}: ${Math.round(load)} ops/s`}
                />
              );
            })}
          </div>
          <div className="text-[9px] text-gray-500 mt-0.5">Shard distribution</div>
        </div>
      )}
    </motion.div>
  );
}

export default memo(SimComponentNode);
