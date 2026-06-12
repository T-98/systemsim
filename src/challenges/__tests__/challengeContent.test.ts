/**
 * @file challenges/__tests__/challengeContent.test.ts
 *
 * Content quality gate (Decisions §72): every challenge shipped in
 * /public/challenges MUST be (a) broken by default — the unmodified graph
 * fails at least one criterion, (b) solvable — applying its knownFix makes
 * every criterion pass, and (c) structurally sound (ids resolve, exactly
 * one correct diagnosis, listed in the index). Runs the real engine
 * headlessly per challenge, seeded for determinism.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runChallenge, buildGraph } from '../harness';
import { evaluateChallenge } from '../evaluate';
import type { Challenge, ChallengeIndexEntry } from '../types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHALLENGE_DIR = path.join(__dirname, '..', '..', '..', 'public', 'challenges');

const files = fs.readdirSync(CHALLENGE_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json');
const index: ChallengeIndexEntry[] = JSON.parse(fs.readFileSync(path.join(CHALLENGE_DIR, 'index.json'), 'utf8'));

describe('challenge index', () => {
  it('lists every challenge file exactly once, with matching metadata', () => {
    const ids = files.map((f) => f.replace(/\.json$/, '')).sort();
    expect(index.map((e) => e.id).sort()).toEqual(ids);
    for (const entry of index) {
      const c: Challenge = JSON.parse(fs.readFileSync(path.join(CHALLENGE_DIR, `${entry.id}.json`), 'utf8'));
      expect(c.id).toBe(entry.id);
      expect(c.title).toBe(entry.title);
      expect(c.difficulty).toBe(entry.difficulty);
    }
  });
});

for (const file of files) {
  const challenge: Challenge = JSON.parse(fs.readFileSync(path.join(CHALLENGE_DIR, file), 'utf8'));

  describe(`challenge: ${challenge.id}`, () => {
    it('is structurally sound', () => {
      expect(challenge.graph.nodes.length).toBeGreaterThan(0);
      expect(challenge.fix.criteria.length).toBeGreaterThan(0);
      expect(challenge.fix.hints.length).toBeGreaterThan(0);
      expect(challenge.knownFix.length).toBeGreaterThan(0);
      // Exactly one correct diagnosis, and every option teaches.
      const correct = challenge.diagnosis.options.filter((o) => o.correct);
      expect(correct).toHaveLength(1);
      for (const o of challenge.diagnosis.options) expect(o.explain.length).toBeGreaterThan(20);
      // Edge refs + starter ids resolve against the deterministic id scheme.
      const { nodes } = buildGraph(challenge.graph);
      const ids = new Set(nodes.map((n) => n.id));
      for (const e of challenge.graph.edges) {
        expect(ids.has(e.source), `edge source ${e.source}`).toBe(true);
        expect(ids.has(e.target), `edge target ${e.target}`).toBe(true);
      }
      for (const ent of challenge.starter.schemaMemory?.entities ?? []) {
        if (ent.assignedDbId) expect(ids.has(ent.assignedDbId), `assignedDbId ${ent.assignedDbId}`).toBe(true);
      }
      for (const c of challenge.starter.apiContracts ?? []) {
        if (c.ownerServiceId) expect(ids.has(c.ownerServiceId), `ownerServiceId ${c.ownerServiceId}`).toBe(true);
      }
    });

    it('fails its criteria when run broken (seeds 7 and 42)', () => {
      for (const seed of [7, 42]) {
        const { run, nodes } = runChallenge(challenge, { seed });
        const { passed } = evaluateChallenge(challenge, run, nodes);
        expect(passed, `broken graph passed criteria at seed ${seed} — challenge teaches nothing`).toBe(false);
      }
    });

    it('passes every criterion with its knownFix (seeds 7 and 42)', () => {
      for (const seed of [7, 42]) {
        const { run, nodes } = runChallenge(challenge, { fix: challenge.knownFix, seed });
        const { passed, results } = evaluateChallenge(challenge, run, nodes);
        const detail = results.map((r) => `${r.criterion.label}: ${r.passed ? 'pass' : `FAIL (${r.observed})`}`).join('; ');
        expect(passed, `knownFix did not satisfy criteria at seed ${seed} — ${detail}`).toBe(true);
      }
    });
  });
}
