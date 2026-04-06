import { useState } from 'react';
import { COMPONENT_CATEGORIES, COMPONENT_DEFS } from '../../types/components';
import { ComponentIcon } from '../nodes/icons';
import { useStore } from '../../store';
import type { ComponentType } from '../../types';

export default function ComponentLibrary() {
  const [search, setSearch] = useState('');
  const addComponent = useStore((s) => s.addComponent);
  const simulationStatus = useStore((s) => s.simulationStatus);
  const isRunning = simulationStatus === 'running' || simulationStatus === 'paused';

  const filteredCategories = COMPONENT_CATEGORIES.map((cat) => ({
    ...cat,
    types: cat.types.filter((t) => {
      const def = COMPONENT_DEFS[t];
      return def.label.toLowerCase().includes(search.toLowerCase()) ||
        def.description.toLowerCase().includes(search.toLowerCase());
    }),
  })).filter((cat) => cat.types.length > 0);

  const onDragStart = (e: React.DragEvent, type: ComponentType) => {
    e.dataTransfer.setData('application/systemsim-component', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="w-56 bg-[#0A0B12] border-r border-[#14161F] flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3.5 border-b border-[#14161F]">
        <input
          type="text"
          placeholder="Search components..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#0C0D14] text-[#8890A8] text-[12px] px-3.5 py-2 rounded-lg border border-[#14161F] placeholder-[#2A2F42] transition-all"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {filteredCategories.map((cat) => (
          <div key={cat.name}>
            <div className="text-[9px] uppercase tracking-[0.25em] text-[#2A2F42] font-semibold px-2 mb-2.5">{cat.label}</div>
            <div className="space-y-0.5">
              {cat.types.map((type) => {
                const def = COMPONENT_DEFS[type];
                return (
                  <div
                    key={type}
                    draggable={!isRunning}
                    onDragStart={(e) => onDragStart(e, type)}
                    onClick={() => !isRunning && addComponent(type)}
                    className={`group flex items-center gap-3 px-2.5 py-2.5 rounded-lg cursor-pointer transition-all duration-200
                      ${isRunning ? 'opacity-25 cursor-not-allowed' : 'hover:bg-[#0E1019]'}`}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all"
                      style={{ backgroundColor: def.categoryColor + '08', border: `1px solid ${def.categoryColor}12` }}>
                      <div className="text-[#4A5068] group-hover:text-[#8890A8] transition-colors" style={{ width: 16, height: 16 }}>
                        <ComponentIcon type={type} />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-[#8890A8] font-medium truncate group-hover:text-white transition-colors leading-tight">{def.label}</div>
                      <div className="text-[10px] text-[#2A2F42] truncate mt-0.5">{def.description}</div>
                    </div>
                    <span className="text-[9px] font-mono text-[#1E2030] bg-[#0C0D14] px-1.5 py-0.5 rounded border border-[#14161F] shrink-0">{def.shortcut}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
