import { describe, it, expect } from 'vitest';
import {
  DESCRIBE_INTENT_PROMPT_VERSION,
  DESCRIBE_INTENT_SYSTEM_PROMPT,
  buildDescribeIntentUserText,
} from '../describeIntentPrompt';

describe('describe-intent prompt', () => {
  it('exports a prompt version string', () => {
    expect(DESCRIBE_INTENT_PROMPT_VERSION).toBe('2.0');
  });

  it('system prompt instructs founder voice', () => {
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('First-person plural');
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('NOT product-marketing');
  });

  it('system prompt enforces structure-first reasoning (STEP order)', () => {
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('STEP 1: COMPONENTS');
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('STEP 2: CONNECTIONS');
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('STEP 3: INTENT');
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('STEP 4: CONFIDENCE');
  });

  it('system prompt restricts to 6 component types', () => {
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('load_balancer');
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('server');
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('database');
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('cache');
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('queue');
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('fanout');
  });

  it('system prompt specifies connection arrow format', () => {
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('SOURCE_LABEL --> TARGET_LABEL');
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('SOURCE_LABEL --EDGE_LABEL--> TARGET_LABEL');
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('ONE EDGE PER LINE');
  });

  it('system prompt forbids arrow reinterpretation', () => {
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('Do not re-interpret arrows');
  });

  it('system prompt rules mandate honest low confidence', () => {
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain("Prefer honest 'low'");
  });

  it('system prompt includes data-artifact rule', () => {
    expect(DESCRIBE_INTENT_SYSTEM_PROMPT).toContain('data artifact');
  });
});

describe('buildDescribeIntentUserText', () => {
  it('returns the trimmed text when present', () => {
    expect(buildDescribeIntentUserText({ text: '  A meme voting app  ' })).toBe('A meme voting app');
  });

  it('returns the image-only fallback when no text', () => {
    expect(buildDescribeIntentUserText({})).toContain('attached image');
  });

  it('returns the fallback for empty string', () => {
    expect(buildDescribeIntentUserText({ text: '   ' })).toContain('attached image');
  });
});
