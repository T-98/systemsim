import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import type { SimComponentData, HealthState } from '../../types';
import { COMPONENT_DEFS } from '../../types/components';
import { ComponentIcon } from './icons';
import { useStore } from '../../store';

const healthBorder: Record<HealthState, string> = {
  healthy: 'border-[#14161F]',
  warning: 'border-amber-500',
  critical: 'border-red-500',
  crashed: 'border-red-900',
};

const healthBg: Record<HealthState, string> = {
  healthy: 'bg-[#0C0D14]',
  warning: 'bg-[#0C0D14]',
  critical: 'bg-[#0C0D14]',
  crashed: 'bg-[#0A0910] opacity-60',
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
        relative min-w-[200px] rounded-xl border ${healthBorder[health]} ${healthBg[health]}
        text-white shadow-lg shadow-black/20 cursor-pointer transition-all duration-200
        ${selected ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-[#08090D]' : ''}
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
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-[#3B82F6] !border-[#08090D] !border-2" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-[#3B82F6] !border-[#08090D] !border-2" />

      <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderLeft: `3px solid ${def.categoryColor}` }}>
        <div className="text-[#8890A8] shrink-0">
          <ComponentIcon type={data.type} />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold truncate text-white">{data.label}</div>
          <div className="text-[10px] text-[#5A6078]">{def.description}</div>
        </div>
        {health === 'crashed' && (
          <div className="absolute top-1.5 right-2 text-red-500 text-lg font-bold">X</div>
        )}
      </div>

      {isRunning && metrics && (
        <div className="px-4 pb-3 text-[10px] text-[#5A6078] space-y-0.5 font-['Geist_Mono',monospace] tabular-nums">
          <div className="flex justify-between">
            <span>RPS</span>
            <span className="text-[#B8BCC8]">{Math.round(metrics.rps).toLocaleString()}</span>
          </div>
          {metrics.p99 > 0 && (
            <div className="flex justify-between">
              <span>p99</span>
              <span className={metrics.p99 > 500 ? 'text-red-400' : 'text-[#B8BCC8]'}>{Math.round(metrics.p99)}ms</span>
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
              <span className={metrics.cpuPercent > 80 ? 'text-red-400' : metrics.cpuPercent > 50 ? 'text-amber-400' : 'text-[#B8BCC8]'}>
                {Math.round(metrics.cpuPercent)}%
              </span>
            </div>
          )}
          {metrics.memoryPercent > 0 && (
            <div className="flex justify-between">
              <span>MEM</span>
              <span className={metrics.memoryPercent > 80 ? 'text-red-400' : 'text-[#B8BCC8]'}>
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
        <div className="px-4 pb-3">
          <div className="flex gap-0.5 h-8 items-end">
            {metrics!.shardDistribution!.map((load, i) => {
              const maxLoad = Math.max(...metrics!.shardDistribution!);
              const pct = maxLoad > 0 ? (load / maxLoad) * 100 : 0;
              const isHot = load > maxLoad * 0.5 && maxLoad > 0;
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-t transition-all duration-200 ${isHot ? 'bg-red-500' : 'bg-emerald-500'}`}
                  style={{ height: `${Math.max(pct, 5)}%` }}
                  title={`Shard ${i}: ${Math.round(load)} ops/s`}
                />
              );
            })}
          </div>
          <div className="text-[9px] text-[#5A6078] mt-1 font-['Geist_Mono',monospace]">Shard distribution</div>
        </div>
      )}
    </motion.div>
  );
}

export default memo(SimComponentNode);
