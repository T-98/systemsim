/**
 * @file layout/dagre.ts
 *
 * Auto-layout wrapper around Dagre for generated diagrams (text-to-diagram,
 * vision-to-intent, templates without explicit positions). Left-to-right
 * flow with consistent spacing.
 */

import Dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';
import type { SimComponentData, WireConfig } from '../types';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

export function layoutGraph(
  nodes: Node<SimComponentData>[],
  edges: Edge<{ config: WireConfig }>[],
): Node<SimComponentData>[] {
  if (nodes.length === 0) return nodes;

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 100 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // Detect cycles via DFS, collect back-edges to exclude from layout
  const backEdgeIds = detectBackEdges(nodes, edges);

  for (const edge of edges) {
    if (!backEdgeIds.has(edge.id)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  Dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });
}

function detectBackEdges(
  nodes: Node<SimComponentData>[],
  edges: Edge<{ config: WireConfig }>[],
): Set<string> {
  const backEdges = new Set<string>();
  const adjacency = new Map<string, { target: string; edgeId: string }[]>();

  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source)!.push({ target: edge.target, edgeId: edge.id });
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const node of nodes) color.set(node.id, WHITE);

  function dfs(u: string) {
    color.set(u, GRAY);
    for (const { target, edgeId } of adjacency.get(u) ?? []) {
      const c = color.get(target);
      if (c === GRAY) {
        backEdges.add(edgeId);
      } else if (c === WHITE) {
        dfs(target);
      }
    }
    color.set(u, BLACK);
  }

  for (const node of nodes) {
    if (color.get(node.id) === WHITE) dfs(node.id);
  }

  return backEdges;
}
