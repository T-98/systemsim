/**
 * @file useSimulation.ts
 *
 * The React-hook driver that owns the simulation engine instance and its
 * setInterval timer. Glues the browser's time-based tick loop to the pure
 * engine in SimulationEngine.ts.
 *
 * Exposes start / stop / pause / resume. On stop, assembles the SimulationRun
 * artifact, triggers the deterministic debrief synchronously, and kicks off
 * the async AI-debrief fetch (falls back gracefully on timeout/error).
 *
 * Metrics time-series is accumulated in `metricsHistoryRef` across ticks so
 * the debrief can compute peaks.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useStore } from '../store';
import { SimulationEngine } from './SimulationEngine';
import { primeCalibration, getCalibrationSet } from './calibration';

/**
 * Chaos controls (Decisions §71). The live engine instance is private to
 * whichever useSimulation instance started the run, but the kill/revive
 * affordances live on canvas nodes — a module-level handle bridges them.
 * Null when no run is active; node UI hides the affordance accordingly.
 */
export const chaosHandle: {
  kill: ((id: string) => boolean) | null;
  revive: ((id: string) => boolean) | null;
} = { kill: null, revive: null };
// Exposed for Playwright (same pattern as window.__SYSTEMSIM_STORE__) — a
// page-context dynamic import would get a second module instance.
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__SYSTEMSIM_CHAOS__ = chaosHandle;
}
import { generateDebrief } from '../ai/debrief';
import { buildSimulationSummary } from '../ai/buildSimulationSummary';
import { fetchAIDebrief } from '../ai/anthropicDebrief';
import type { TrafficProfile, SimulationRun, HealthState } from '../types';
import { v4 as uuid } from 'uuid';

/**
 * React hook that owns the simulation lifecycle. Returns stable callbacks
 * for start / stop / pause / resume.
 *
 * @returns simulation controls bound to the global store
 */
export function useSimulation() {
  const engineRef = useRef<SimulationEngine | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const metricsHistoryRef = useRef<Record<string, import('../types').ComponentMetrics[]>>({});
  const graphVersionRef = useRef<number | null>(null);

  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const graphVersion = useStore((s) => s.graphVersion);
  const schemaMemory = useStore((s) => s.schemaMemory);
  const endpointRoutes = useStore((s) => s.endpointRoutes);
  const apiContracts = useStore((s) => s.apiContracts);
  const setSimulationStatus = useStore((s) => s.setSimulationStatus);
  const setSimulationTime = useStore((s) => s.setSimulationTime);
  const simulationSpeed = useStore((s) => s.simulationSpeed);
  const setParticles = useStore((s) => s.setParticles);
  const addLogEntry = useStore((s) => s.addLogEntry);
  const clearLiveLog = useStore((s) => s.clearLiveLog);
  const updateLiveMetrics = useStore((s) => s.updateLiveMetrics);
  const updateComponentHealth = useStore((s) => s.updateComponentHealth);
  const setLiveWireStates = useStore((s) => s.setLiveWireStates);
  const addSimulationRun = useStore((s) => s.addSimulationRun);
  const setCurrentRunId = useStore((s) => s.setCurrentRunId);
  const resetSimulationState = useStore((s) => s.resetSimulationState);

  // Unmount cleanup (review P2): without this, an unmounting Toolbar would
  // leave the interval ticking and the module-level chaosHandle pointing at
  // an orphaned engine.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      engineRef.current = null;
      chaosHandle.kill = null;
      chaosHandle.revive = null;
    };
  }, []);

  // Phase 8a.2 — kick off the calibration.json fetch once per session.
  // Idempotent fire-and-forget; the engine reads whatever has loaded by the
  // time the user hits Run (shipped files are empty defaults, so an
  // unsettled fetch is indistinguishable from a loaded one today).
  useEffect(() => {
    primeCalibration();
  }, []);

  // Graph-swap teardown: if the graph is replaced (graphVersion bumped) while
  // an engine instance is live, tear it down so stale ticks don't write
  // metrics/wireStates from the OLD topology onto the NEW one.
  // See Codex finding #1 on Phase 3 UI review.
  useEffect(() => {
    if (graphVersionRef.current === null) {
      graphVersionRef.current = graphVersion;
      return;
    }
    if (graphVersion !== graphVersionRef.current) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      engineRef.current = null;
      chaosHandle.kill = null;
      chaosHandle.revive = null;
      metricsHistoryRef.current = {};
      graphVersionRef.current = graphVersion;
    }
  }, [graphVersion]);

  // Shared tick body — used by both startSimulation and resumeSimulation
  // Returns true if simulation is complete
  const runTick = useCallback((): boolean => {
    if (!engineRef.current) return false;

    const result = engineRef.current.tick();

    setSimulationTime(result.time);
    setParticles(result.particles);

    // Update metrics + track history for debrief
    for (const [componentId, metrics] of Object.entries(result.metrics)) {
      updateLiveMetrics(componentId, metrics);
      if (!metricsHistoryRef.current[componentId]) metricsHistoryRef.current[componentId] = [];
      metricsHistoryRef.current[componentId].push({ ...metrics });
    }

    // Update health
    for (const [componentId, health] of Object.entries(result.healths)) {
      updateComponentHealth(componentId, health as HealthState);
    }

    // Publish per-wire breaker + error state for UI edge rendering
    setLiveWireStates(result.wireStates);

    // Add new log entries
    for (const log of result.newLogs) {
      addLogEntry(log);
    }

    return engineRef.current.isComplete();
  }, [setSimulationTime, setParticles, updateLiveMetrics, updateComponentHealth, setLiveWireStates, addLogEntry]);

  const stressedRef = useRef<boolean>(false);

  const stopSimulation = useCallback((runId?: string, trafficProfile?: TrafficProfile) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const engine = engineRef.current;
    if (!engine) return;

    const finalRunId = runId ?? useStore.getState().currentRunId ?? uuid();
    const profile = trafficProfile ?? useStore.getState().trafficProfile;

    // Compile simulation run
    const run: SimulationRun = {
      runId: finalRunId,
      timestamp: new Date().toISOString(),
      schemaVersion: schemaMemory?.version ?? 0,
      trafficProfile: profile!,
      metricsTimeSeries: metricsHistoryRef.current,
      log: engine.getLog(),
      stressedMode: stressedRef.current,
    };

    addSimulationRun(run);
    setSimulationStatus('completed');
    engineRef.current = null;
    chaosHandle.kill = null;
    chaosHandle.revive = null;

    // Auto-generate deterministic debrief (instant, shows immediately)
    const state = useStore.getState();
    const debrief = generateDebrief({
      nodes: state.nodes,
      edges: state.edges,
      functionalReqs: state.functionalReqs,
      nonFunctionalReqs: state.nonFunctionalReqs,
      apiContracts: state.apiContracts,
      schemaMemory: state.schemaMemory,
      simulationRun: run,
      scenarioId: state.scenarioId,
    });
    useStore.getState().setDebrief(debrief);
    useStore.getState().setDebriefVisible(true);
    useStore.getState().setBottomPanelTab('debrief');
    // Design-review F-03: the debrief is the payoff — open it at reading
    // height instead of a 180px strip behind a tiny "Expand" link.
    useStore.getState().setLogPanelExpanded(true);

    // Async AI debrief — merge questions when ready, fallback on failure
    useStore.getState().setDebriefLoading(true);
    const summary = buildSimulationSummary(state.nodes, state.edges, run, schemaMemory?.entities.find((e) => e.partitionKey)?.partitionKey);

    fetchAIDebrief(summary, state.scenarioId).then((aiResult) => {
      const current = useStore.getState().debrief;
      if (!current) return;

      if (aiResult) {
        useStore.getState().setDebrief({
          ...current,
          aiQuestions: aiResult.questions,
          aiAvailable: true,
        });
      }
      useStore.getState().setDebriefLoading(false);
    });
  }, [schemaMemory, addSimulationRun, setSimulationStatus]);

  const startSimulation = useCallback((trafficProfile: TrafficProfile, stressedMode = false) => {
    resetSimulationState();
    clearLiveLog();
    metricsHistoryRef.current = {};
    stressedRef.current = stressedMode;

    // Legacy constructor-global `schemaShardKey`/`schemaShardKeyCardinality`
    // are ONLY consulted by `resolveShardKeyForDb` when no per-DB source
    // resolves. Two cases:
    //   - schemaMemory has entities with `assignedDbId` set → per-DB
    //     lookup is authoritative; pre-deriving globals would leak one
    //     DB's partition key onto DBs with no assignment (§63 cross-DB
    //     bleed). Pass undefined.
    //   - schemaMemory has no assigned entities (older saves pre-dating
    //     the designer's DB-assignment step) → per-DB lookup returns
    //     nothing for every DB, and without globals the engine falls
    //     through to `{null, 'high'}` — regresses single-DB hot-shard
    //     modeling. Keep the legacy first-entity derivation in that
    //     case so pre-assignment saves still shard correctly. Codex
    //     round 6 [P2].
    let shardKey: string | undefined;
    let shardKeyCardinality: 'low' | 'medium' | 'high' | undefined;
    if (schemaMemory) {
      const hasAssigned = schemaMemory.entities.some((e) => e.assignedDbId !== null);
      if (!hasAssigned) {
        for (const entity of schemaMemory.entities) {
          if (entity.partitionKey) {
            shardKey = entity.partitionKey;
            const field = entity.fields.find((f) => f.name === entity.partitionKey);
            shardKeyCardinality = field?.cardinality;
            break;
          }
        }
      }
    }

    const engine = new SimulationEngine(
      nodes,
      edges,
      trafficProfile,
      shardKey,
      shardKeyCardinality,
      undefined,
      stressedMode,
      {
        endpointRoutes,
        schemaMemory,
        requestMix: trafficProfile.requestMix,
        apiContracts,
      },
      getCalibrationSet(),
    );
    engineRef.current = engine;
    chaosHandle.kill = (id: string) => engine.injectCrash(id);
    chaosHandle.revive = (id: string) => engine.revive(id);

    const runId = uuid();
    setCurrentRunId(runId);
    setSimulationStatus('running');
    useStore.getState().setBottomPanelOpen(true);
    useStore.getState().setBottomPanelTab('log');

    const tickRate = 1000 / simulationSpeed;

    timerRef.current = setInterval(() => {
      const complete = runTick();
      if (complete) {
        stopSimulation(runId, trafficProfile);
      }
    }, tickRate);
  }, [nodes, edges, schemaMemory, endpointRoutes, apiContracts, simulationSpeed, resetSimulationState, clearLiveLog, setSimulationStatus, setCurrentRunId, runTick, stopSimulation]);

  const pauseSimulation = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setSimulationStatus('paused');
  }, [setSimulationStatus]);

  const resumeSimulation = useCallback(() => {
    if (!engineRef.current) return;
    setSimulationStatus('running');

    const tickRate = 1000 / simulationSpeed;
    timerRef.current = setInterval(() => {
      const complete = runTick();
      if (complete) {
        stopSimulation();
      }
    }, tickRate);
  }, [simulationSpeed, setSimulationStatus, runTick, stopSimulation]);

  return { startSimulation, stopSimulation, pauseSimulation, resumeSimulation };
}
