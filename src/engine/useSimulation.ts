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

import { useRef, useCallback } from 'react';
import { useStore } from '../store';
import { SimulationEngine } from './SimulationEngine';
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

  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const schemaMemory = useStore((s) => s.schemaMemory);
  const setSimulationStatus = useStore((s) => s.setSimulationStatus);
  const setSimulationTime = useStore((s) => s.setSimulationTime);
  const simulationSpeed = useStore((s) => s.simulationSpeed);
  const setParticles = useStore((s) => s.setParticles);
  const addLogEntry = useStore((s) => s.addLogEntry);
  const clearLiveLog = useStore((s) => s.clearLiveLog);
  const updateLiveMetrics = useStore((s) => s.updateLiveMetrics);
  const updateComponentHealth = useStore((s) => s.updateComponentHealth);
  const addSimulationRun = useStore((s) => s.addSimulationRun);
  const setCurrentRunId = useStore((s) => s.setCurrentRunId);
  const resetSimulationState = useStore((s) => s.resetSimulationState);

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

    // Add new log entries
    for (const log of result.newLogs) {
      addLogEntry(log);
    }

    return engineRef.current.isComplete();
  }, [setSimulationTime, setParticles, updateLiveMetrics, updateComponentHealth, addLogEntry]);

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

    // Determine schema shard key info
    let shardKey: string | undefined;
    let shardKeyCardinality: 'low' | 'medium' | 'high' | undefined;
    if (schemaMemory) {
      for (const entity of schemaMemory.entities) {
        if (entity.partitionKey) {
          shardKey = entity.partitionKey;
          const field = entity.fields.find((f) => f.name === entity.partitionKey);
          shardKeyCardinality = field?.cardinality;
          break;
        }
      }
    }

    const engine = new SimulationEngine(nodes, edges, trafficProfile, shardKey, shardKeyCardinality, undefined, stressedMode);
    engineRef.current = engine;

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
  }, [nodes, edges, schemaMemory, simulationSpeed, resetSimulationState, clearLiveLog, setSimulationStatus, setCurrentRunId, runTick, stopSimulation]);

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
