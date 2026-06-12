/**
 * @file components/canvas/ChallengeBanner.tsx
 *
 * Drill HUD (Decisions §72). Sits above the canvas while a challenge is
 * active and walks the user through three steps:
 *
 *   observe  — the broken design auto-ran; story + symptom, watch the log.
 *   diagnose — multiple choice; wrong answers teach (explain), right answer
 *              unlocks the fix phase.
 *   fix      — objective + hints; every completed run is evaluated against
 *              the challenge criteria and the per-criterion verdicts render
 *              here; all green → passed.
 *
 * Evaluation lives in this component's effect: when a run completes while a
 * challenge is active, the latest SimulationRun is scored. Pure function —
 * no AI, no network (challenges/evaluate.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { evaluateChallenge, formatObserved } from '../../challenges/evaluate';

export default function ChallengeBanner() {
  const challenge = useStore((s) => s.activeChallenge);
  const step = useStore((s) => s.challengeStep);
  const setStep = useStore((s) => s.setChallengeStep);
  const picked = useStore((s) => s.diagnosisPicked);
  const setPicked = useStore((s) => s.setDiagnosisPicked);
  const results = useStore((s) => s.challengeResults);
  const setResults = useStore((s) => s.setChallengeResults);
  const simulationStatus = useStore((s) => s.simulationStatus);
  const simulationRuns = useStore((s) => s.simulationRuns);
  const openWiki = useStore((s) => s.openWiki);
  const [hintsShown, setHintsShown] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  // Local panel state belongs to ONE drill — the banner never unmounts
  // between drills (it renders null), so reset on drill change. Review P2.
  useEffect(() => {
    setHintsShown(0);
    setCollapsed(false);
  }, [challenge?.id]);

  // Score every completed run while a drill is active; clear stale verdicts
  // the moment a new run starts so last run's ✓/✕ never pose as live.
  const latestRunId = simulationRuns.length > 0 ? simulationRuns[simulationRuns.length - 1].runId : null;
  useEffect(() => {
    if (!challenge) return;
    if (simulationStatus === 'running') {
      setResults(null);
      return;
    }
    if (simulationStatus !== 'completed' || !latestRunId) return;
    const run = useStore.getState().simulationRuns.slice(-1)[0];
    const { passed, results: r } = evaluateChallenge(challenge, run, useStore.getState().nodes);
    setResults(r);
    if (passed && (useStore.getState().challengeStep === 'fix')) setStep('passed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.id, simulationStatus, latestRunId]);

  const pickedOption = useMemo(
    () => challenge?.diagnosis.options.find((o) => o.id === picked) ?? null,
    [challenge, picked],
  );

  if (!challenge) return null;

  const isRunning = simulationStatus === 'running' || simulationStatus === 'paused';

  return (
    <div
      data-testid="challenge-banner"
      data-step={step}
      style={{
        margin: '12px 16px 0',
        padding: collapsed ? '10px 16px' : '14px 18px',
        borderRadius: 11,
        background: 'var(--bg-card)',
        border: step === 'passed' ? '1px solid var(--success, #30d158)' : '1px solid var(--accent)',
        position: 'relative',
        zIndex: 5,
      }}
    >
      <div className="flex items-center justify-between" style={{ gap: 12 }}>
        <div className="flex items-center" style={{ gap: 10, minWidth: 0 }}>
          <span
            className="uppercase font-medium shrink-0"
            style={{ fontSize: 10, letterSpacing: '0.2em', color: step === 'passed' ? 'var(--success, #30d158)' : 'var(--accent)' }}
          >
            {step === 'passed' ? 'Drill passed' : `Drill · ${challenge.kbRef}`}
          </span>
          <span className="truncate font-semibold" style={{ fontSize: 14, color: 'var(--text-primary)', letterSpacing: '-0.224px' }}>
            {challenge.title}
          </span>
          <StepDots step={step} />
        </div>
        <div className="flex items-center shrink-0" style={{ gap: 10 }}>
          <button
            type="button"
            data-testid="challenge-study"
            onClick={() => openWiki(challenge.topicKey)}
            style={linkStyle}
          >
            Study {challenge.kbRef}
          </button>
          <button
            type="button"
            data-testid="challenge-collapse"
            onClick={() => setCollapsed(!collapsed)}
            style={linkStyle}
            aria-label={collapsed ? 'Expand drill panel' : 'Collapse drill panel'}
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
          <button
            type="button"
            data-testid="challenge-exit"
            onClick={() => useStore.getState().setActiveChallenge(null)}
            style={{ ...linkStyle, color: 'var(--text-tertiary)' }}
          >
            Exit
          </button>
        </div>
      </div>

      {!collapsed && step === 'observe' && (
        <div style={{ marginTop: 10 }}>
          <p style={bodyStyle}>{challenge.brief}</p>
          <p style={{ ...bodyStyle, color: 'var(--text-tertiary)', marginTop: 6 }}>
            <strong style={{ color: 'var(--warning)' }}>Watch for:</strong> {challenge.symptom}
          </p>
          <button
            type="button"
            data-testid="challenge-to-diagnose"
            disabled={isRunning && simulationRuns.length === 0}
            onClick={() => setStep('diagnose')}
            style={primaryBtn}
          >
            I've seen enough — diagnose it
          </button>
        </div>
      )}

      {!collapsed && step === 'diagnose' && (
        <div style={{ marginTop: 10 }}>
          <p style={{ ...bodyStyle, fontWeight: 600, color: 'var(--text-primary)' }}>{challenge.diagnosis.question}</p>
          <div className="flex flex-col" style={{ gap: 6, marginTop: 8 }}>
            {challenge.diagnosis.options.map((o) => {
              const isPicked = picked === o.id;
              const verdictColor = o.correct ? 'var(--success, #30d158)' : 'var(--destructive)';
              return (
                <button
                  key={o.id}
                  type="button"
                  data-testid={`diagnosis-${o.id}`}
                  onClick={() => setPicked(o.id)}
                  style={{
                    textAlign: 'left',
                    padding: '8px 12px',
                    borderRadius: 8,
                    fontSize: 13,
                    letterSpacing: '-0.12px',
                    background: isPicked ? 'var(--bg-hover)' : 'var(--bg-input)',
                    border: `1px solid ${isPicked ? verdictColor : 'var(--border-color)'}`,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {o.text}
                  {isPicked && (
                    <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: verdictColor }}>
                      {o.correct ? '✓ ' : '✕ '}{o.explain}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {pickedOption?.correct && (
            <button type="button" data-testid="challenge-to-fix" onClick={() => setStep('fix')} style={primaryBtn}>
              Right. Now fix it
            </button>
          )}
        </div>
      )}

      {!collapsed && (step === 'fix' || step === 'passed') && (
        <div style={{ marginTop: 10 }}>
          <p style={bodyStyle}>
            <strong style={{ color: 'var(--text-primary)' }}>Objective:</strong> {challenge.fix.objective}
          </p>
          <div className="flex flex-col" style={{ gap: 4, marginTop: 8 }} data-testid="challenge-criteria">
            {challenge.fix.criteria.map((c, i) => {
              const r = results?.[i];
              const state = !r ? 'pending' : r.passed ? 'pass' : 'fail';
              return (
                <div key={i} className="flex items-center" style={{ gap: 8, fontSize: 13, letterSpacing: '-0.12px' }}>
                  <span style={{
                    color: state === 'pass' ? 'var(--success, #30d158)' : state === 'fail' ? 'var(--destructive)' : 'var(--text-tertiary)',
                    width: 14, textAlign: 'center',
                  }}>
                    {state === 'pass' ? '✓' : state === 'fail' ? '✕' : '·'}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>{c.label}</span>
                  {r && (
                    <span style={{ color: 'var(--text-tertiary)', fontFamily: "'Geist Mono', monospace", fontSize: 12 }}>
                      {formatObserved(r)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {step === 'passed' ? (
            <p style={{ ...bodyStyle, color: 'var(--success, #30d158)', marginTop: 10, fontWeight: 600 }} data-testid="challenge-passed">
              Fixed. That's the real skill — read the symptoms, name the cause, change the design.
              Read the theory behind it in {challenge.kbRef}.
            </p>
          ) : (
            <div style={{ marginTop: 10 }}>
              <span style={{ ...bodyStyle, color: 'var(--text-tertiary)' }}>
                Edit configs or the structure, then <strong>Run</strong> to check your fix.
              </span>
              {hintsShown < challenge.fix.hints.length && (
                <button
                  type="button"
                  data-testid="challenge-hint"
                  onClick={() => setHintsShown(hintsShown + 1)}
                  style={{ ...linkStyle, marginLeft: 10 }}
                >
                  Hint {hintsShown + 1}/{challenge.fix.hints.length}
                </button>
              )}
              {challenge.fix.hints.slice(0, hintsShown).map((h, i) => (
                <p key={i} style={{ ...bodyStyle, color: 'var(--text-tertiary)', marginTop: 6 }}>
                  {i + 1}. {h}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepDots({ step }: { step: string }) {
  const steps = ['observe', 'diagnose', 'fix'];
  const idx = step === 'passed' ? 3 : steps.indexOf(step);
  return (
    <span className="flex items-center shrink-0" style={{ gap: 4 }} aria-label={`Step: ${step}`}>
      {steps.map((s, i) => (
        <span
          key={s}
          style={{
            width: 6, height: 6, borderRadius: 3,
            background: i < idx ? 'var(--success, #30d158)' : i === idx ? 'var(--accent)' : 'var(--border-strong)',
          }}
        />
      ))}
    </span>
  );
}

const bodyStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  letterSpacing: '-0.12px',
  color: 'var(--text-secondary)',
  margin: 0,
};

const linkStyle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: '-0.12px',
  color: 'var(--accent-link)',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: '4px 2px',
};

const primaryBtn: React.CSSProperties = {
  marginTop: 10,
  padding: '8px 14px',
  fontSize: 13,
  letterSpacing: '-0.12px',
  borderRadius: 8,
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  border: 'none',
  cursor: 'pointer',
};
