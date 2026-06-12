/**
 * @file challenges/loadChallenge.ts
 *
 * Fetch a drill from /public/challenges/<id>.json and stage it (Decisions
 * §72): broken graph on the canvas, starter state applied (same contract as
 * template starters, §70), challenge HUD armed, and an auto-run requested so
 * the user SEES the failure within seconds of clicking the card.
 */

import { useStore } from '../store';
import type { Challenge } from './types';

const SAFE_SLUG_RE = /^[a-zA-Z0-9_-]+$/;

export async function loadChallenge(id: string): Promise<boolean> {
  if (!SAFE_SLUG_RE.test(id)) return false;
  let challenge: Challenge;
  try {
    const res = await fetch(`/challenges/${id}.json`);
    if (!res.ok) return false;
    challenge = await res.json();
  } catch {
    return false;
  }
  if (!challenge?.graph?.nodes?.length || !challenge?.fix?.criteria?.length) return false;

  const s = useStore.getState();
  // Order matters: replaceGraph clears any prior drill; starter pieces apply
  // to the NEW graph (setApiContracts BFS walks it); the challenge arms the
  // HUD last; the auto-run request fires once Toolbar's effect sees it.
  s.replaceGraph({ nodes: challenge.graph.nodes, edges: challenge.graph.edges }, { layout: 'auto' });
  s.setAppMode('freeform');
  s.setScenarioId(null);
  s.setIntent(null);
  s.setTrafficProfile(challenge.starter.trafficProfile);
  if (challenge.starter.schemaMemory) s.setSchemaMemory(challenge.starter.schemaMemory);
  // Clear stale routes BEFORE setApiContracts: it reuses existing routes by
  // endpointId, and drills share contract ids — loading drill B after drill A
  // would otherwise inherit A's component chains (stale → even-split
  // fallback → wrong attribution → drill behavior diverges from the
  // harness-verified numbers). Review P1.
  s.setEndpointRoutes([]);
  if (challenge.starter.apiContracts) s.setApiContracts(challenge.starter.apiContracts);
  s.setActiveChallenge(challenge);
  s.setAppView('canvas');
  s.setAutoRunRequested(true);
  return true;
}
