/**
 * @file wiki/components/FlowDiagram.tsx
 *
 * Inline architecture flow diagram for Reference docs (Decisions §72).
 * Authors drop `<FlowDiagram chain="..." />` into KB markdown; MarkdownBody
 * splices this component in (same mechanism as CanvasEmbed).
 *
 * DSL — one attribute, human-writable:
 *   chain="lb:Load Balancer -> server:API ×3 -> db:Postgres"
 * Multiple rows separated by `|`:
 *   chain="client:Users -> lb:LB -> server:API | server:API -> queue:Jobs -> server:Worker"
 * Node syntax: `type:Label` where type is a canvas ComponentType (renders
 * the canvas icon + category color, tying docs visuals to the product) or
 * one of the extras: client, generic. Bare labels default to generic.
 * Annotated arrows: `-x->` (failure path, red) and `-?->` (dashed, optional).
 */

import { Fragment } from 'react';
import { ComponentIcon } from '../../components/nodes/icons';
import { COMPONENT_DEFS } from '../../types/components';
import type { ComponentType } from '../../types';

interface FlowNode {
  type: ComponentType | 'client' | 'generic';
  label: string;
}
type ArrowKind = 'normal' | 'failure' | 'optional';
interface FlowRow {
  nodes: FlowNode[];
  arrows: ArrowKind[];
}

const KNOWN_TYPES = new Set([...Object.keys(COMPONENT_DEFS), 'client', 'generic']);

export function parseChain(chain: string): FlowRow[] {
  return chain
    .split('|')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      // Tokenize on arrows, capturing the arrow flavor.
      const parts = row.split(/(-x->|-\?->|->)/).map((p) => p.trim());
      const nodes: FlowNode[] = [];
      const arrows: ArrowKind[] = [];
      for (const part of parts) {
        if (part === '->') arrows.push('normal');
        else if (part === '-x->') arrows.push('failure');
        else if (part === '-?->') arrows.push('optional');
        else if (part.length > 0) {
          const ci = part.indexOf(':');
          const maybeType = ci > 0 ? part.slice(0, ci).trim() : '';
          if (maybeType && KNOWN_TYPES.has(maybeType)) {
            nodes.push({ type: maybeType as FlowNode['type'], label: part.slice(ci + 1).trim() });
          } else {
            nodes.push({ type: 'generic', label: part });
          }
        }
      }
      return { nodes, arrows };
    })
    .filter((r) => r.nodes.length > 0);
}

const ARROW_STYLE: Record<ArrowKind, { color: string; char: string; dashed?: boolean }> = {
  normal: { color: 'var(--text-tertiary)', char: '→' },
  failure: { color: 'var(--destructive)', char: '⇥' },
  optional: { color: 'var(--text-tertiary)', char: '⇢' },
};

export default function FlowDiagram({ chain }: { chain: string }) {
  const rows = parseChain(chain);
  if (rows.length === 0) return null;

  return (
    <div
      data-testid="flow-diagram"
      style={{
        margin: '20px 0',
        padding: '16px 18px',
        borderRadius: 11,
        border: '1px solid var(--border-color)',
        background: 'var(--bg-card)',
        overflowX: 'auto',
      }}
    >
      {rows.map((row, ri) => (
        <div
          key={ri}
          className="flex items-center"
          style={{ gap: 10, marginTop: ri > 0 ? 12 : 0, flexWrap: 'nowrap', minWidth: 'max-content' }}
        >
          {row.nodes.map((n, ni) => (
            <Fragment key={ni}>
              {ni > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    color: ARROW_STYLE[row.arrows[ni - 1] ?? 'normal'].color,
                    fontSize: 16,
                    flexShrink: 0,
                  }}
                >
                  {ARROW_STYLE[row.arrows[ni - 1] ?? 'normal'].char}
                </span>
              )}
              <span
                className="flex items-center shrink-0"
                style={{
                  gap: 7,
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  borderLeft: n.type !== 'generic' && n.type !== 'client'
                    ? `3px solid ${COMPONENT_DEFS[n.type as ComponentType]?.categoryColor ?? 'var(--border-color)'}`
                    : '1px solid var(--border-color)',
                  background: 'var(--bg-input)',
                  fontSize: 13,
                  letterSpacing: '-0.12px',
                  color: 'var(--text-primary)',
                }}
              >
                {n.type !== 'generic' && n.type !== 'client' && (
                  <span className="flow-icon" style={{ color: 'var(--text-tertiary)', display: 'inline-flex' }}>
                    <ComponentIcon type={n.type as ComponentType} />
                  </span>
                )}
                {n.type === 'client' && <span aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>◇</span>}
                {n.label}
              </span>
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}
