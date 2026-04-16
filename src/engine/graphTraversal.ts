interface GraphNode {
  id: string;
  data?: { config?: Record<string, unknown> };
}

interface GraphEdge {
  source: string;
  target: string;
}

export function buildAdjacency(edges: GraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  return adj;
}

export function buildReverseAdjacency(edges: GraphEdge[]): Map<string, string[]> {
  const rev = new Map<string, string[]>();
  for (const e of edges) {
    if (!rev.has(e.target)) rev.set(e.target, []);
    rev.get(e.target)!.push(e.source);
  }
  return rev;
}

export function bfs(
  adj: Map<string, string[]>,
  from: string,
  to: string,
): string[] | null {
  if (from === to) return [from];
  const visited = new Set<string>([from]);
  const queue: string[][] = [[from]];

  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    const neighbors = adj.get(current) ?? [];

    for (const neighbor of neighbors) {
      if (neighbor === to) return [...path, neighbor];
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }

  return null;
}

export function findEntryPoints(
  nodes: GraphNode[],
  edges: GraphEdge[],
): string[] {
  const rev = buildReverseAdjacency(edges);
  const explicit: string[] = [];
  const zeroIndegree: string[] = [];

  for (const node of nodes) {
    if (node.data?.config?.isEntry === true) {
      explicit.push(node.id);
    }
    const incoming = rev.get(node.id);
    if (!incoming || incoming.length === 0) {
      zeroIndegree.push(node.id);
    }
  }

  if (explicit.length > 0) return explicit;
  return zeroIndegree;
}

export function findDisconnected(
  nodes: GraphNode[],
  edges: GraphEdge[],
): string[] {
  const adj = buildAdjacency(edges);
  const rev = buildReverseAdjacency(edges);
  return nodes
    .filter((n) => {
      const hasOut = (adj.get(n.id) ?? []).length > 0;
      const hasIn = (rev.get(n.id) ?? []).length > 0;
      return !hasOut && !hasIn;
    })
    .map((n) => n.id);
}

export function isReachable(
  adj: Map<string, string[]>,
  from: string,
  to: string,
): boolean {
  return bfs(adj, from, to) !== null;
}
