/**
 * @file graphTraversal.ts
 *
 * Graph helpers shared across engine, preflight, and store. Works on plain
 * `{ source, target }` edges so callers don't need to pass full xyflow Edge types.
 *
 * Entry-point semantics: prefer explicit `config.isEntry === true`, fall back
 * to zero-indegree. Only one set is used; no mixing.
 */

interface GraphNode {
  id: string;
  data?: { config?: Record<string, unknown> };
}

interface GraphEdge {
  source: string;
  target: string;
}

/** Build `source → [targets]` adjacency map from edges. */
export function buildAdjacency(edges: GraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  return adj;
}

/** Build `target → [sources]` adjacency (used for indegree checks). */
export function buildReverseAdjacency(edges: GraphEdge[]): Map<string, string[]> {
  const rev = new Map<string, string[]>();
  for (const e of edges) {
    if (!rev.has(e.target)) rev.set(e.target, []);
    rev.get(e.target)!.push(e.source);
  }
  return rev;
}

/** Shortest-path BFS. Returns the path or `null` if unreachable. */
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

/**
 * Entry points for simulation traffic. Explicit `isEntry` flag wins if any
 * node sets it; otherwise falls back to zero-indegree nodes.
 */
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

/** Nodes with no incoming AND no outgoing edges. Flagged by preflight. */
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

/** True when a path exists from → to. Convenience wrapper around bfs. */
export function isReachable(
  adj: Map<string, string[]>,
  from: string,
  to: string,
): boolean {
  return bfs(adj, from, to) !== null;
}

/**
 * Topological ordering of nodes reachable from `entries` with explicit
 * back-edge marking. Used by the simulation engine so each component's
 * processor runs exactly once per tick in dependency order (upstream before
 * downstream), with cycle-closing wires flagged as back edges so their
 * contributions can fall back to previous-tick metrics.
 *
 * Algorithm: iterative DFS from each entry. Colour = 0 (unseen), 1 (on
 * stack — grey), 2 (finished — black). An edge `u → v` where `v` is grey
 * is a back edge (cycle-closing). Post-order finish → reversed = topo
 * order. When cycles exist, the DAG induced by non-back edges still has a
 * valid topo order and we return that.
 *
 * `edgeId(source, target)` builds the key used for back-edge lookup; the
 * engine uses the same `source|target` shape for its wire state maps.
 */
export function topologicalOrder(
  edges: GraphEdge[],
  entries: string[],
): { order: string[]; backEdges: Set<string> } {
  const adj = buildAdjacency(edges);
  const colour = new Map<string, number>();
  const finished: string[] = [];
  const backEdges = new Set<string>();

  type Frame = { id: string; iter: Iterator<string> };

  for (const entry of entries) {
    if (colour.get(entry)) continue;
    const stack: Frame[] = [{ id: entry, iter: (adj.get(entry) ?? [])[Symbol.iterator]() }];
    colour.set(entry, 1);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const step = top.iter.next();
      if (step.done) {
        colour.set(top.id, 2);
        finished.push(top.id);
        stack.pop();
        continue;
      }
      const next = step.value;
      const c = colour.get(next) ?? 0;
      if (c === 1) {
        // Grey on stack → back edge (cycle-closing).
        backEdges.add(`${top.id}|${next}`);
      } else if (c === 0) {
        colour.set(next, 1);
        stack.push({ id: next, iter: (adj.get(next) ?? [])[Symbol.iterator]() });
      }
      // c === 2: already finished, cross/forward edge — no back-edge semantics needed.
    }
  }

  // DFS finish order reversed = topological order (for the DAG of non-back edges).
  return { order: finished.reverse(), backEdges };
}
