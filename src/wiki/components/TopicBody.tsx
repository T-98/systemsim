/**
 * @file wiki/components/TopicBody.tsx
 *
 * Main-pane renderer for a single topic. At Phase A-scaffold all bodies
 * are empty, so this component mostly shows the "content coming soon"
 * empty state. At Phase A-content, `body` will carry real Markdown from
 * the knowledge base and we'll swap the renderer for a proper Markdown
 * component.
 *
 * How-to entries render a "Load in canvas" button that (at A-scaffold)
 * is a disabled stub — Phase A-content wires it to real JSON templates
 * under `src/scenarios/howto/`.
 */

import { lookupTopic } from '../topics';

export default function TopicBody({ topicKey }: { topicKey: string | null }) {
  if (!topicKey) {
    return (
      <div
        data-testid="wiki-empty"
        style={{ color: 'var(--text-tertiary)', fontSize: 14, letterSpacing: '-0.12px' }}
      >
        Pick a topic on the left.
      </div>
    );
  }

  const info = lookupTopic(topicKey);
  const isEmpty = !info.body || info.body.trim() === '';

  return (
    <article
      data-testid="wiki-body"
      data-topic={topicKey}
      data-body-empty={isEmpty ? 'true' : 'false'}
      style={{ maxWidth: 720 }}
    >
      <header style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
            color: 'var(--text-tertiary)',
            marginBottom: 6,
          }}
        >
          {info.category}
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: '-0.6px',
            color: 'var(--text-primary)',
            margin: 0,
          }}
        >
          {info.title}
        </h1>
      </header>

      {isEmpty ? (
        <div
          data-testid="wiki-empty-state"
          style={{
            padding: 20,
            borderRadius: 10,
            border: '1px dashed var(--border-color)',
            color: 'var(--text-tertiary)',
            fontSize: 14,
            lineHeight: 1.55,
            letterSpacing: '-0.12px',
          }}
        >
          Content coming soon — we're building our knowledge base.
        </div>
      ) : (
        <div
          style={{
            fontSize: 15,
            lineHeight: 1.65,
            color: 'var(--text-secondary)',
            letterSpacing: '-0.12px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {info.body}
        </div>
      )}

      {info.category === 'howto' && (
        <div style={{ marginTop: 28 }}>
          <button
            type="button"
            data-testid="wiki-howto-load"
            data-howto-template={info.howtoTemplate ?? ''}
            disabled
            title="Templates land in Phase A-content"
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              background: 'var(--accent)',
              color: 'white',
              border: 'none',
              fontSize: 14,
              letterSpacing: '-0.12px',
              cursor: 'not-allowed',
              opacity: 0.5,
            }}
          >
            Load in canvas (coming soon)
          </button>
        </div>
      )}
    </article>
  );
}
