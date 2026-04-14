/**
 * Prompt eval runner for /api/describe-intent.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm eval:describe-intent
 *
 * Modes (via RUN_MODE env var):
 *   - "sdk" (default): calls Anthropic SDK directly, bypasses the Vercel endpoint.
 *     Faster, no local dev server needed. Tests the prompt + schema + validator.
 *   - "http": POSTs to http://localhost:5180/api/describe-intent. Requires `pnpm dev`.
 *     Tests the full endpoint (including magic-byte validation, payload caps).
 *
 * Fixtures live in ./fixtures/ as pairs:
 *   <case>.input.json  (text) or <case>.input.png + <case>.input.txt (image + optional text)
 *   <case>.expected.json  (ground truth)
 */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { validateDescribeIntent, type DescribeIntentOutput } from '../../src/ai/describeIntentSchema';
import {
  DESCRIBE_INTENT_SYSTEM_PROMPT,
  buildDescribeIntentUserText,
} from '../../src/ai/describeIntentPrompt';
import { DESCRIBE_INTENT_TOOL_SCHEMA } from '../../src/ai/describeIntentSchema';

const MODEL_ID_VISION = 'claude-opus-4-6';
const PASS_THRESHOLD = 6;

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');
const OUTPUT_DIR = join(__dirname, '.evals-output');

interface ExpectedCase {
  components: Array<{ label: string; type: string }>;
  connections: Array<{ source: string; target: string }>;
  notes?: string;
}

interface FixtureBundle {
  name: string;
  text?: string;
  image?: { base64: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' };
  expected: ExpectedCase;
}

interface ScoreResult {
  name: string;
  dimensions: Record<string, boolean>;
  notes: string[];
  passed: boolean;
  output?: DescribeIntentOutput;
  error?: string;
}

const BANNED_MARKETING_PHRASES = [
  'users can',
  'seamlessly',
  'empower',
  'unlock the power',
  'revolutionize',
  'next-generation',
];

function normalize(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function discoverFixtures(): Promise<FixtureBundle[]> {
  let files: string[] = [];
  try {
    files = await readdir(FIXTURES_DIR);
  } catch {
    return [];
  }

  const byName = new Map<string, Partial<FixtureBundle & { expectedRaw?: unknown }>>();

  for (const file of files) {
    const full = join(FIXTURES_DIR, file);
    const ext = extname(file);
    const stem = basename(file, ext);
    const { base, role } = parseFixtureName(stem, ext);
    if (!base || !role) continue;

    const entry = byName.get(base) ?? { name: base };
    if (role === 'input-json') {
      const raw = JSON.parse(await readFile(full, 'utf-8'));
      entry.text = typeof raw.text === 'string' ? raw.text : undefined;
    } else if (role === 'input-txt') {
      entry.text = await readFile(full, 'utf-8');
    } else if (role === 'input-image') {
      const buffer = await readFile(full);
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      entry.image = { base64: buffer.toString('base64'), mimeType };
    } else if (role === 'expected') {
      const raw = JSON.parse(await readFile(full, 'utf-8'));
      entry.expected = raw;
    }
    byName.set(base, entry);
  }

  const bundles: FixtureBundle[] = [];
  for (const [name, entry] of byName) {
    if (!entry.expected) {
      console.warn(`[eval] skipping ${name}: missing *.expected.json`);
      continue;
    }
    if (!entry.text && !entry.image) {
      console.warn(`[eval] skipping ${name}: no input text or image`);
      continue;
    }
    bundles.push({
      name,
      text: entry.text,
      image: entry.image,
      expected: entry.expected as ExpectedCase,
    });
  }
  return bundles;
}

function parseFixtureName(stem: string, ext: string): { base: string; role: string } {
  if (stem.endsWith('.input')) {
    const base = stem.slice(0, -'.input'.length);
    if (ext === '.json') return { base, role: 'input-json' };
    if (ext === '.txt') return { base, role: 'input-txt' };
    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp') {
      return { base, role: 'input-image' };
    }
  }
  if (stem.endsWith('.expected') && ext === '.json') {
    return { base: stem.slice(0, -'.expected'.length), role: 'expected' };
  }
  return { base: '', role: '' };
}

async function callDescribeIntentSdk(
  anthropic: Anthropic,
  bundle: FixtureBundle
): Promise<DescribeIntentOutput> {
  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

  const content: ContentBlock[] = [];
  if (bundle.image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: bundle.image.mimeType, data: bundle.image.base64 },
    });
  }
  content.push({ type: 'text', text: buildDescribeIntentUserText({ text: bundle.text }) });

  const response = await anthropic.messages.create({
    model: MODEL_ID_VISION,
    max_tokens: 3072,
    system: DESCRIBE_INTENT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: content as never }],
    tools: [DESCRIBE_INTENT_TOOL_SCHEMA as never],
    tool_choice: { type: 'tool', name: 'describe_intent' },
  });

  const toolBlock = response.content.find((b) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error('tool_use missing from response');
  }
  const validation = validateDescribeIntent(toolBlock.input);
  if (!validation.ok) throw new Error(`validation failed: ${validation.reason}`);
  return validation.data;
}

function scoreCase(bundle: FixtureBundle, output: DescribeIntentOutput): ScoreResult {
  const dims: Record<string, boolean> = {};
  const notes: string[] = [];

  const expectedCount = bundle.expected.components.length;
  dims.components_count = Math.abs(output.components.length - expectedCount) <= 1;
  if (!dims.components_count) {
    notes.push(`components_count: expected ~${expectedCount}, got ${output.components.length}`);
  }

  const expectedTypes = new Set(bundle.expected.components.map((c) => c.type));
  const gotTypes = new Set(output.components.map((c) => c.type));
  const missingTypes = [...expectedTypes].filter((t) => !gotTypes.has(t));
  dims.component_types = missingTypes.length === 0;
  if (!dims.component_types) {
    notes.push(`component_types: missing [${missingTypes.join(', ')}]`);
  }

  const gotLabels = new Set(output.components.map((c) => normalize(c.label)));
  const missingLabels = bundle.expected.components
    .map((c) => c.label)
    .filter((l) => !gotLabels.has(normalize(l)));
  dims.component_labels = missingLabels.length === 0;
  if (!dims.component_labels) {
    notes.push(`component_labels: missing [${missingLabels.join(', ')}]`);
  }

  const gotEdges = output.connections
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const expectedCountEdges = bundle.expected.connections.length;
  dims.connections_count = Math.abs(gotEdges.length - expectedCountEdges) <= 2;
  if (!dims.connections_count) {
    notes.push(`connections_count: expected ~${expectedCountEdges}, got ${gotEdges.length}`);
  }

  const gotEdgeSet = new Set(
    gotEdges.map((line) => {
      const m = line.match(/^(.+?)\s*(?:--[^-]*--)?\s*-->\s*(.+)$/);
      if (!m) return '';
      return `${normalize(m[1])}→${normalize(m[2])}`;
    })
  );
  const missingEdges = bundle.expected.connections.filter(
    (e) => !gotEdgeSet.has(`${normalize(e.source)}→${normalize(e.target)}`)
  );
  dims.connection_pairs = missingEdges.length === 0;
  if (!dims.connection_pairs) {
    notes.push(
      `connection_pairs: missing [${missingEdges
        .map((e) => `${e.source} → ${e.target}`)
        .join(', ')}]`
    );
  }

  dims.intent_voice = /^we\b/i.test(output.intent.trim());
  if (!dims.intent_voice) {
    notes.push(`intent_voice: intent doesn't start with first-person plural "We"`);
  }

  const intentLower = output.intent.toLowerCase();
  const foundBanned = BANNED_MARKETING_PHRASES.filter((p) => intentLower.includes(p));
  dims.intent_no_marketing = foundBanned.length === 0;
  if (!dims.intent_no_marketing) {
    notes.push(`intent_no_marketing: contains [${foundBanned.join(', ')}]`);
  }

  dims.confidence_shape =
    ['low', 'med', 'high'].includes(output.confidence.intent) &&
    Array.isArray(output.confidence.items);

  const passCount = Object.values(dims).filter(Boolean).length;
  return {
    name: bundle.name,
    dimensions: dims,
    notes,
    passed: passCount >= PASS_THRESHOLD,
    output,
  };
}

function printTable(results: ScoreResult[]): void {
  const dimNames = [
    'components_count',
    'component_types',
    'component_labels',
    'connections_count',
    'connection_pairs',
    'intent_voice',
    'intent_no_marketing',
    'confidence_shape',
  ];
  const nameW = Math.max(12, ...results.map((r) => r.name.length));
  const dimHeader = dimNames.map((d) => d.slice(0, 4)).join(' ');
  console.log(`\n${'CASE'.padEnd(nameW)}  ${dimHeader}  SCORE  RESULT`);
  console.log('─'.repeat(nameW + dimHeader.length + 20));
  for (const r of results) {
    if (r.error) {
      console.log(`${r.name.padEnd(nameW)}  ${'ERROR'.padEnd(dimHeader.length)}  -/-   ✗ ${r.error}`);
      continue;
    }
    const marks = dimNames.map((d) => (r.dimensions[d] ? '✓' : '✗').padEnd(4)).join(' ');
    const score = Object.values(r.dimensions).filter(Boolean).length;
    const total = Object.keys(r.dimensions).length;
    const verdict = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${r.name.padEnd(nameW)}  ${marks}  ${score}/${total}   ${verdict}`);
  }
  console.log();
  for (const r of results) {
    if (r.notes.length > 0) {
      console.log(`▸ ${r.name}:`);
      for (const n of r.notes) console.log(`    ${n}`);
    }
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is required.');
    process.exit(1);
  }

  const bundles = await discoverFixtures();
  if (bundles.length === 0) {
    console.log('No fixtures found under evals/describe-intent/fixtures/.');
    console.log('See evals/README.md for how to add cases.');
    process.exit(0);
  }

  console.log(`Running ${bundles.length} eval case${bundles.length === 1 ? '' : 's'} against ${MODEL_ID_VISION}...\n`);

  const anthropic = new Anthropic({ apiKey });
  await mkdir(OUTPUT_DIR, { recursive: true });

  const results: ScoreResult[] = [];
  for (const bundle of bundles) {
    try {
      const output = await callDescribeIntentSdk(anthropic, bundle);
      await writeFile(
        join(OUTPUT_DIR, `${bundle.name}.output.json`),
        JSON.stringify(output, null, 2)
      );
      results.push(scoreCase(bundle, output));
    } catch (err) {
      results.push({
        name: bundle.name,
        dimensions: {},
        notes: [],
        passed: false,
        error: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  printTable(results);

  const passCount = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`\n${passCount}/${total} cases passed.`);
  if (passCount < total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
