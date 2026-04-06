import { useRef, useCallback } from 'react';
import { useStore } from '../store';
import { SimulationEngine } from './SimulationEngine';
import { generateDebrief } from '../ai/debrief';
import type { TrafficProfile, SimulationRun, HealthState } from '../types';
import { v4 as uuid } from 'uuid';

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

  const startSimulation = useCallback((trafficProfile: TrafficProfile) => {
    resetSimulationState();
    clearLiveLog();
    metricsHistoryRef.current = {};

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

    const engine = new SimulationEngine(nodes, edges, trafficProfile, shardKey, shardKeyCardinality);
    engineRef.current = engine;

    const runId = uuid();
    setCurrentRunId(runId);
    setSimulationStatus('running');

    const tickRate = 1000 / simulationSpeed; // ms between ticks (1s sim time per tick)

    timerRef.current = setInterval(() => {
      if (!engineRef.current) return;

      const result = engineRef.current.tick();

      setSimulationTime(result.time);
      setParticles(result.particles);

      // Update metrics
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

      // Check if simulation is complete
      if (engineRef.current.isComplete()) {
        stopSimulation(runId, trafficProfile);
      }
    }, tickRate);
  }, [nodes, edges, schemaMemory, simulationSpeed, resetSimulationState, clearLiveLog, setSimulationStatus, setSimulationTime, setParticles, updateLiveMetrics, updateComponentHealth, addLogEntry, setCurrentRunId, addSimulationRun]);

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
    };

    addSimulationRun(run);
    setSimulationStatus('completed');
    engineRef.current = null;

    // Auto-generate debrief
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
  }, [schemaMemory, addSimulationRun, setSimulationStatus]);

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

    const tickRate = 100 / simulationSpeed;
    timerRef.current = setInterval(() => {
      if (!engineRef.current) return;
      const result = engineRef.current.tick();
      setSimulationTime(result.time);
      setParticles(result.particles);
      for (const [componentId, metrics] of Object.entries(result.metrics)) {
        updateLiveMetrics(componentId, metrics);
      }
      for (const [componentId, health] of Object.entries(result.healths)) {
        updateComponentHealth(componentId, health as HealthState);
      }
      for (const log of result.newLogs) {
        addLogEntry(log);
      }
      if (engineRef.current.isComplete()) {
        stopSimulation();
      }
    }, tickRate);
  }, [simulationSpeed, setSimulationStatus, setSimulationTime, setParticles, updateLiveMetrics, updateComponentHealth, addLogEntry, stopSimulation]);

  return { startSimulation, stopSimulation, pauseSimulation, resumeSimulation };
}
