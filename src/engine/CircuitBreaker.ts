/**
 * @file CircuitBreaker.ts
 *
 * Per-wire circuit breaker state machine. Opt-in: only wires with
 * `WireConfig.circuitBreaker` config get a breaker. All other wires skip
 * breaker logic entirely (existing tests and scenarios unchanged).
 *
 * State machine:
 *
 *     CLOSED ──(N consecutive failed ticks)──→ OPEN
 *        ▲                                      │
 *        │                               (cooldownSeconds elapsed)
 *        │                                      ▼
 *        │                                 HALF_OPEN
 *        │                                      │
 *        └──(M consecutive healthy ticks)───────┘
 *                                               │
 *                              (any failure)────┘
 *                                               ↓
 *                                              OPEN
 *
 * A tick is "failed" when the target component's `errorRate` exceeds
 * `failureThreshold` at end of tick (evaluated in `evaluateBreaker`).
 *
 * Called by SimulationEngine:
 * - `forwardOverWire` checks `state.status` before recursing. OPEN → drop.
 * - End of each tick, `evaluateBreaker` runs for every wire with a breaker.
 */

export type BreakerStatus = 'closed' | 'open' | 'half_open';

/**
 * Mutable per-wire breaker state. Lives on WireState, not in config.
 *
 * `hadTrafficThisTick` is set by `forwardOverWire` whenever a request
 * actually flows through the wire this tick. Critical for HALF_OPEN: a
 * probe must have actually run before we can declare success. Otherwise
 * a quiet phase could let the breaker recover without a single request
 * validating the downstream.
 */
export interface CircuitBreakerState {
  status: BreakerStatus;
  consecutiveFailureTicks: number;
  consecutiveSuccessTicks: number;
  cooldownUntilTime: number;
  hadTrafficThisTick: boolean;
}

/** User-tunable breaker config. Attach to WireConfig to enable. */
export interface CircuitBreakerConfig {
  /** errorRate (0-1) above which a tick counts as a failure */
  failureThreshold: number;
  /** consecutive failure ticks that trip CLOSED → OPEN */
  failureWindow: number;
  /** seconds in OPEN before trying HALF_OPEN */
  cooldownSeconds: number;
  /** consecutive healthy ticks in HALF_OPEN to return to CLOSED */
  halfOpenTicks: number;
}

/**
 * Sane defaults for breakers. Failure at 50% errorRate for 3 ticks, 10s
 * cooldown, 2 healthy ticks to close. Tuned to trip only on genuine
 * sustained failure, not one-tick blips.
 */
export const DEFAULT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 0.5,
  failureWindow: 3,
  cooldownSeconds: 10,
  halfOpenTicks: 2,
};

/** Fresh breaker state (CLOSED, no failures, no cooldown). */
export function makeBreakerState(): CircuitBreakerState {
  return {
    status: 'closed',
    consecutiveFailureTicks: 0,
    consecutiveSuccessTicks: 0,
    cooldownUntilTime: 0,
    hadTrafficThisTick: false,
  };
}

/** Apply config defaults to a partial user-supplied breaker config. */
export function resolveBreakerConfig(partial: Partial<CircuitBreakerConfig> = {}): CircuitBreakerConfig {
  return { ...DEFAULT_BREAKER_CONFIG, ...partial };
}

/** Result of evaluating the breaker at end of tick. Used for transition logging. */
export interface BreakerTransition {
  from: BreakerStatus;
  to: BreakerStatus;
}

/**
 * Advance the breaker state machine by one tick. Mutates `state` in place
 * and returns the transition (if any) so the caller can log it.
 *
 * @param state  mutable breaker state
 * @param config resolved breaker config (use resolveBreakerConfig)
 * @param errorRate the downstream target's errorRate for this tick (0-1)
 * @param currentTime simulation time in seconds (at end of tick)
 */
export function evaluateBreaker(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig,
  errorRate: number,
  currentTime: number,
): BreakerTransition | null {
  const failed = errorRate > config.failureThreshold;
  const prev = state.status;

  if (state.status === 'closed') {
    if (failed) {
      state.consecutiveFailureTicks++;
      if (state.consecutiveFailureTicks >= config.failureWindow) {
        state.status = 'open';
        state.cooldownUntilTime = currentTime + config.cooldownSeconds;
        return { from: prev, to: 'open' };
      }
    } else {
      state.consecutiveFailureTicks = 0;
    }
    return null;
  }

  if (state.status === 'open') {
    if (currentTime >= state.cooldownUntilTime) {
      state.status = 'half_open';
      state.consecutiveSuccessTicks = 0;
      state.consecutiveFailureTicks = 0;
      return { from: prev, to: 'half_open' };
    }
    return null;
  }

  // half_open
  if (failed) {
    state.status = 'open';
    state.cooldownUntilTime = currentTime + config.cooldownSeconds;
    state.consecutiveSuccessTicks = 0;
    return { from: prev, to: 'open' };
  }
  // CRITICAL: no-traffic ticks do NOT count as probe success. A HALF_OPEN
  // breaker must see at least one real request complete healthily before
  // we can declare the downstream recovered. Without this guard, a quiet
  // phase would silently close the breaker without validation.
  if (!state.hadTrafficThisTick) return null;
  state.consecutiveSuccessTicks++;
  if (state.consecutiveSuccessTicks >= config.halfOpenTicks) {
    state.status = 'closed';
    state.consecutiveFailureTicks = 0;
    return { from: prev, to: 'closed' };
  }
  return null;
}
