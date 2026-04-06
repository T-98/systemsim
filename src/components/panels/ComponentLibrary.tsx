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
    <div className="w-56 bg-[#13151E] border-r border-[#1E2030] flex flex-col h-full overflow-hidden">
      <div className="p-3 border-b border-[#1E2030]">
        <input
          type="text"
          placeholder="Search components..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#1A1D27] text-gray-300 text-xs px-3 py-2 rounded-sm border border-[#2A2D3A] focus:border-blue-500 focus:outline-none placeholder-gray-600"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {filteredCategories.map((cat) => (
          <div key={cat.name}>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 px-2 mb-1">{cat.label}</div>
            <div className="space-y-1">
              {cat.types.map((type) => {
                const def = COMPONENT_DEFS[type];
                return (
                  <div
                    key={type}
                    draggable={!isRunning}
                    onDragStart={(e) => onDragStart(e, type)}
                    onClick={() => !isRunning && addComponent(type)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-colors
                      ${isRunning ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[#1E2235]'}`}
                    style={{ borderLeft: `2px solid ${def.categoryColor}` }}
                  >
                    <div className="text-gray-400 shrink-0" style={{ width: 18, height: 18 }}>
                      <ComponentIcon type={type} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-gray-300 truncate">{def.label}</div>
                      <div className="text-[10px] text-gray-600 truncate">{def.shortcut}</div>
                    </div>
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
