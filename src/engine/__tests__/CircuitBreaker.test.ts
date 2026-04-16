import { describe, it, expect } from 'vitest';
import {
  evaluateBreaker,
  makeBreakerState,
  resolveBreakerConfig,
  DEFAULT_BREAKER_CONFIG,
} from '../CircuitBreaker';

describe('CircuitBreaker', () => {
  describe('resolveBreakerConfig', () => {
    it('returns defaults when given nothing', () => {
      const cfg = resolveBreakerConfig();
      expect(cfg).toEqual(DEFAULT_BREAKER_CONFIG);
    });

    it('overrides only specified fields', () => {
      const cfg = resolveBreakerConfig({ failureWindow: 5 });
      expect(cfg.failureWindow).toBe(5);
      expect(cfg.failureThreshold).toBe(DEFAULT_BREAKER_CONFIG.failureThreshold);
      expect(cfg.cooldownSeconds).toBe(DEFAULT_BREAKER_CONFIG.cooldownSeconds);
    });
  });

  describe('CLOSED → OPEN transition', () => {
    it('stays CLOSED when errorRate is below threshold', () => {
      const state = makeBreakerState();
      const cfg = resolveBreakerConfig();
      expect(evaluateBreaker(state, cfg, 0.3, 0)).toBeNull();
      expect(state.status).toBe('closed');
    });

    it('stays CLOSED after a single failure (below failureWindow)', () => {
      const state = makeBreakerState();
      const cfg = resolveBreakerConfig({ failureWindow: 3 });
      evaluateBreaker(state, cfg, 0.8, 0);
      expect(state.status).toBe('closed');
      expect(state.consecutiveFailureTicks).toBe(1);
    });

    it('trips to OPEN after failureWindow consecutive failures', () => {
      const state = makeBreakerState();
      const cfg = resolveBreakerConfig({ failureWindow: 3, cooldownSeconds: 10 });
      evaluateBreaker(state, cfg, 0.8, 1);
      evaluateBreaker(state, cfg, 0.8, 2);
      const transition = evaluateBreaker(state, cfg, 0.8, 3);
      expect(state.status).toBe('open');
      expect(state.cooldownUntilTime).toBe(13); // 3 + 10
      expect(transition).toEqual({ from: 'closed', to: 'open' });
    });

    it('resets failure counter on a healthy tick', () => {
      const state = makeBreakerState();
      const cfg = resolveBreakerConfig({ failureWindow: 3 });
      evaluateBreaker(state, cfg, 0.8, 0);
      evaluateBreaker(state, cfg, 0.8, 1);
      evaluateBreaker(state, cfg, 0.2, 2); // healthy tick
      expect(state.consecutiveFailureTicks).toBe(0);
      evaluateBreaker(state, cfg, 0.8, 3); // one failure again
      expect(state.status).toBe('closed'); // not enough to trip
    });
  });

  describe('OPEN → HALF_OPEN transition', () => {
    it('stays OPEN while in cooldown', () => {
      const state = makeBreakerState();
      state.status = 'open';
      state.cooldownUntilTime = 10;
      const cfg = resolveBreakerConfig();
      expect(evaluateBreaker(state, cfg, 0, 5)).toBeNull();
      expect(state.status).toBe('open');
    });

    it('moves to HALF_OPEN when cooldown elapses', () => {
      const state = makeBreakerState();
      state.status = 'open';
      state.cooldownUntilTime = 10;
      const cfg = resolveBreakerConfig();
      const transition = evaluateBreaker(state, cfg, 0, 10);
      expect(state.status).toBe('half_open');
      expect(transition).toEqual({ from: 'open', to: 'half_open' });
    });
  });

  describe('HALF_OPEN transitions', () => {
    it('HALF_OPEN → OPEN on first failed tick', () => {
      const state = makeBreakerState();
      state.status = 'half_open';
      const cfg = resolveBreakerConfig({ cooldownSeconds: 10 });
      const transition = evaluateBreaker(state, cfg, 0.8, 20);
      expect(state.status).toBe('open');
      expect(state.cooldownUntilTime).toBe(30);
      expect(transition).toEqual({ from: 'half_open', to: 'open' });
    });

    it('HALF_OPEN → CLOSED after halfOpenTicks healthy ticks with actual traffic', () => {
      const state = makeBreakerState();
      state.status = 'half_open';
      const cfg = resolveBreakerConfig({ halfOpenTicks: 2 });
      state.hadTrafficThisTick = true;
      evaluateBreaker(state, cfg, 0.1, 1); // healthy probe
      expect(state.status).toBe('half_open');
      state.hadTrafficThisTick = true;
      const transition = evaluateBreaker(state, cfg, 0.1, 2); // healthy probe
      expect(state.status).toBe('closed');
      expect(transition).toEqual({ from: 'half_open', to: 'closed' });
    });

    it('HALF_OPEN with NO traffic does NOT count as a success', () => {
      // Codex-caught bug: a quiet phase would silently recover the breaker.
      // A probe must actually run before we declare the downstream healthy.
      const state = makeBreakerState();
      state.status = 'half_open';
      const cfg = resolveBreakerConfig({ halfOpenTicks: 1 });
      // hadTrafficThisTick left false — simulating no traffic through this wire
      const transition = evaluateBreaker(state, cfg, 0, 1);
      expect(state.status).toBe('half_open');
      expect(transition).toBeNull();
      expect(state.consecutiveSuccessTicks).toBe(0);
    });
  });

  describe('full cycle', () => {
    it('CLOSED → OPEN → HALF_OPEN → CLOSED', () => {
      const state = makeBreakerState();
      const cfg = resolveBreakerConfig({ failureWindow: 2, cooldownSeconds: 5, halfOpenTicks: 1 });
      evaluateBreaker(state, cfg, 0.9, 1);
      evaluateBreaker(state, cfg, 0.9, 2); // trips to OPEN
      expect(state.status).toBe('open');
      evaluateBreaker(state, cfg, 0, 7); // cooldown elapsed → HALF_OPEN
      expect(state.status).toBe('half_open');
      state.hadTrafficThisTick = true;
      evaluateBreaker(state, cfg, 0.1, 8); // one healthy probe → CLOSED
      expect(state.status).toBe('closed');
    });
  });
});
