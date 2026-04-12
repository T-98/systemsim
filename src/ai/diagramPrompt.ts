export const PROMPT_VERSION = '1.0';

const SYSTEM_PROMPT = `You are a distributed systems architect. Given a text description of a system, generate a component diagram using the generate_system_diagram tool.

ALLOWED COMPONENT TYPES (use only these):
- load_balancer: Distributes traffic across instances (use for API gateways too)
- server: Processes requests with CPU/memory (use for workers, consumers, processors)
- database: Persistent storage with sharding (use for object storage, search engines)
- cache: In-memory caching like Redis (use for CDN, edge cache with ttlSeconds:3600)
- queue: Async message processing (use for Kafka, RabbitMQ, SQS, SNS, message brokers)
- fanout: Multiplies messages to N downstream (use for pub/sub)

MAPPING TABLE for common terms NOT in the allowlist:
- CDN, edge cache, CloudFront, Fastly → cache
- Object storage (S3, GCS, blob store) → database
- Search (Elasticsearch, Algolia, Meili) → database
- WebSocket server → server
- API Gateway → load_balancer
- Message broker (Kafka, RabbitMQ, SQS, SNS) → queue
- Workers, consumers, processors → server
- Pub/sub fanout → fanout

RULES:
1. Model only the critical data path. Omit: monitoring, logging, analytics, admin dashboards, auth services, CDN assets, service mesh, tracing.
2. If the user describes 20+ services, pick the 10-15 most important to the data path.
3. Max 15 nodes, max 30 edges. No self-loops.
4. Use local ref tokens (n1, n2, n3...) for edges. Labels are display-only.
5. Never emit multiple nodes of the same type with the same label. If the user mentions "3 servers", emit ONE server node labeled appropriately.
6. Do NOT emit ids, positions, or config. Just ref, type, and label per node. Source and target per edge.

EXAMPLE:
User: "A notification system with a load balancer, two API servers, a message queue, and a database"
Output: nodes=[{ref:"n1",type:"load_balancer",label:"LB"},{ref:"n2",type:"server",label:"API Servers"},{ref:"n3",type:"queue",label:"Notification Queue"},{ref:"n4",type:"database",label:"Notifications DB"}], edges=[{source:"n1",target:"n2"},{source:"n2",target:"n3"},{source:"n2",target:"n4"}]`;

interface BuildPromptOptions {
  mode: 'generate' | 'remix';
  userText: string;
  currentGraph?: { nodes: Array<{ type: string; label: string }>; edges: Array<{ source: string; target: string }> };
}

export function buildPrompt(options: BuildPromptOptions): { system: string; user: string } {
  const { mode, userText, currentGraph } = options;

  if (mode === 'remix' && currentGraph) {
    const graphDesc = currentGraph.nodes
      .map((n, i) => `n${i + 1}: ${n.type} "${n.label}"`)
      .join('\n');
    const edgeDesc = currentGraph.edges
      .map((e) => `${e.source} → ${e.target}`)
      .join('\n');

    return {
      system: SYSTEM_PROMPT,
      user: `Current system diagram:\n${graphDesc}\n\nConnections:\n${edgeDesc}\n\nModification requested: ${userText}\n\nGenerate the COMPLETE updated diagram (not just the changes). Include all existing components plus any additions/removals.`,
    };
  }

  return {
    system: SYSTEM_PROMPT,
    user: userText,
  };
}
