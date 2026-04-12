import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const TEMPLATES_DIR = join(__dirname, '../../../public/templates');
const ALLOWED_TYPES = new Set([
  'load_balancer', 'server', 'database', 'cache', 'queue', 'fanout',
  'api_gateway', 'websocket_gateway', 'cdn', 'external', 'autoscaler',
]);

describe('template validation (build-time)', () => {
  const indexRaw = readFileSync(join(TEMPLATES_DIR, 'index.json'), 'utf-8');
  const index = JSON.parse(indexRaw) as Array<{ id: string; name: string; tags: string[] }>;

  it('index.json is a valid array with at least 5 entries', () => {
    expect(Array.isArray(index)).toBe(true);
    expect(index.length).toBeGreaterThanOrEqual(5);
  });

  it('every index entry has required fields', () => {
    for (const entry of index) {
      expect(entry.id).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(Array.isArray(entry.tags)).toBe(true);
    }
  });

  it('every indexed template has a matching JSON file', () => {
    for (const entry of index) {
      const path = join(TEMPLATES_DIR, `${entry.id}.json`);
      const raw = readFileSync(path, 'utf-8');
      const tpl = JSON.parse(raw);
      expect(tpl.systemsimVersion).toBe('1.0');
      expect(tpl.nodes.length).toBeGreaterThanOrEqual(1);
    }
  });

  const templateFiles = readdirSync(TEMPLATES_DIR).filter(
    (f) => f.endsWith('.json') && f !== 'index.json'
  );

  for (const file of templateFiles) {
    describe(`template: ${file}`, () => {
      const raw = readFileSync(join(TEMPLATES_DIR, file), 'utf-8');
      const tpl = JSON.parse(raw);

      it('has valid systemsimVersion', () => {
        expect(tpl.systemsimVersion).toBe('1.0');
      });

      it('has metadata with name and tags', () => {
        expect(tpl.metadata.name).toBeTruthy();
        expect(Array.isArray(tpl.metadata.tags)).toBe(true);
      });

      it('all nodes have allowed component types', () => {
        for (const node of tpl.nodes) {
          expect(ALLOWED_TYPES.has(node.type)).toBe(true);
        }
      });

      it('all nodes have labels', () => {
        for (const node of tpl.nodes) {
          expect(node.label).toBeTruthy();
          expect(node.label.length).toBeLessThanOrEqual(40);
        }
      });

      it('has at most 15 nodes and 30 edges', () => {
        expect(tpl.nodes.length).toBeLessThanOrEqual(15);
        expect(tpl.edges.length).toBeLessThanOrEqual(30);
      });

      it('all edge source/target reference valid node ids', () => {
        const nodeIds = new Set(
          tpl.nodes.map((_: any, i: number) => `${tpl.nodes[i].type}-${i}`)
        );
        for (const edge of tpl.edges) {
          expect(nodeIds.has(edge.source)).toBe(true);
          expect(nodeIds.has(edge.target)).toBe(true);
        }
      });

      it('no self-loops', () => {
        for (const edge of tpl.edges) {
          expect(edge.source).not.toBe(edge.target);
        }
      });
    });
  }
});
