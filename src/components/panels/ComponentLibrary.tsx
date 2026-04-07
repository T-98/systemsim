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
    <div
      className="w-56 flex flex-col h-full overflow-hidden"
      style={{
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-color)',
      }}
    >
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)' }}>
        <input
          type="text"
          placeholder="Search components..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full transition-all"
          style={{
            background: 'var(--bg-input)',
            color: 'var(--text-secondary)',
            fontSize: '14px',
            letterSpacing: '-0.224px',
            padding: '8px 14px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
          }}
        />
      </div>
      <div className="flex-1 overflow-y-auto" style={{ padding: '16px 12px' }}>
        <div className="space-y-5">
          {filteredCategories.map((cat) => (
            <div key={cat.name}>
              <div
                className="font-semibold uppercase"
                style={{
                  fontSize: '10px',
                  letterSpacing: '0.25em',
                  color: 'var(--text-tertiary)',
                  padding: '0 8px',
                  marginBottom: '10px',
                }}
              >
                {cat.label}
              </div>
              <div className="space-y-0.5">
                {cat.types.map((type) => {
                  const def = COMPONENT_DEFS[type];
                  return (
                    <div
                      key={type}
                      draggable={!isRunning}
                      onDragStart={(e) => onDragStart(e, type)}
                      onClick={() => !isRunning && addComponent(type)}
                      className="group flex items-center gap-3 rounded-lg cursor-pointer transition-all duration-200"
                      style={{
                        padding: '10px',
                        opacity: isRunning ? 0.25 : 1,
                        cursor: isRunning ? 'not-allowed' : 'pointer',
                      }}
                      onMouseEnter={(e) => { if (!isRunning) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all"
                        style={{ backgroundColor: def.categoryColor + '08', border: `1px solid ${def.categoryColor}12` }}
                      >
                        <div style={{ width: 16, height: 16, color: 'var(--text-tertiary)' }}>
                          <ComponentIcon type={type} />
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className="font-medium truncate leading-tight"
                          style={{ fontSize: '14px', color: 'var(--text-secondary)', letterSpacing: '-0.224px' }}
                        >
                          {def.label}
                        </div>
                        <div
                          className="truncate"
                          style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px', letterSpacing: '-0.12px' }}
                        >
                          {def.description}
                        </div>
                      </div>
                      <span
                        className="font-mono shrink-0"
                        style={{
                          fontSize: '10px',
                          color: 'var(--text-tertiary)',
                          background: 'var(--bg-input)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        {def.shortcut}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
