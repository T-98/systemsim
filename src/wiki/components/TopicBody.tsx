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

import { lookupTopic, type TopicCategory } from '../topics';
import MarkdownBody from './MarkdownBody';
import PrevNextFooter from './PrevNextFooter';

/**
 * Design-review F-13: generated topics (Learn / Reference / How-to) carry
 * their title as a leading `# Heading` AND derive their shortDescription
 * from the body's first paragraph — so the page showed the title twice and
 * the opening paragraph twice. The header owns the title; strip a duplicate
 * leading h1 from the body, and suppress the lede when it's just a
 * truncated echo of the body's first paragraph.
 */
function stripLeadingTitle(body: string): string {
  return body.replace(/^\s*# [^\n]*\n+/, '');
}

function isEchoLede(lede: string, bodyWithoutTitle: string): boolean {
  const firstPara = bodyWithoutTitle.split(/\n{2,}/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  const normalizedLede = lede.replace(/…$/, '').replace(/\s+/g, ' ').trim();
  if (!normalizedLede || !firstPara) return false;
  return firstPara.startsWith(normalizedLede.slice(0, Math.min(normalizedLede.length, 80)));
}

const CATEGORY_LABEL: Record<TopicCategory, string> = {
  userGuide: 'Learn',
  reference: 'System design',
  component: 'Component',
  concept: 'Concept',
  config: 'Configuration',
  severity: 'Log severity',
  howto: 'How-to',
};

// Breadcrumbs only add information on the Reference tab, which mixes categories.
// For Learn and How-to, `Tab > Category` is redundant. (codex feedback)
const SHOW_BREADCRUMB: Record<TopicCategory, boolean> = {
  userGuide: false,
  reference: true,
  component: true,
  concept: true,
  config: true,
  severity: true,
  howto: false,
};

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
  const showBreadcrumb = SHOW_BREADCRUMB[info.category];
  const breadcrumbLabel = CATEGORY_LABEL[info.category];
  const bodyMarkdown = isEmpty ? '' : stripLeadingTitle(info.body);
  const showLede = !!info.shortDescription && !isEchoLede(info.shortDescription, bodyMarkdown);

  return (
    <article
      data-testid="wiki-body"
      data-topic={topicKey}
      data-body-empty={isEmpty ? 'true' : 'false'}
      style={{ maxWidth: 720 }}
    >
      <header style={{ marginBottom: 24 }}>
        {showBreadcrumb && (
          <div
            data-testid="wiki-breadcrumb"
            style={{
              fontSize: 13,
              letterSpacing: '-0.224px',
              color: 'var(--text-tertiary)',
              marginBottom: 8,
            }}
          >
            Reference <span style={{ padding: '0 8px' }}>›</span> {breadcrumbLabel}
          </div>
        )}
        <h1
          style={{
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: '-0.5px',
            color: 'var(--text-primary)',
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          {info.title}
        </h1>
        {showLede && (
          <p
            data-testid="wiki-lede"
            style={{
              fontSize: 16,
              lineHeight: 1.5,
              letterSpacing: '-0.24px',
              color: 'var(--text-tertiary)',
              margin: '12px 0 0',
              maxWidth: 640,
            }}
          >
            {info.shortDescription}
          </p>
        )}
      </header>

      {isEmpty ? (
        <div
          data-testid="wiki-empty-state"
          style={{
            padding: 20,
            borderRadius: 8,
            border: '1px dashed var(--border-color)',
            color: 'var(--text-tertiary)',
            fontSize: 14,
            lineHeight: 1.55,
            letterSpacing: '-0.12px',
          }}
        >
          Content coming soon.
        </div>
      ) : (
        <MarkdownBody markdown={bodyMarkdown} />
      )}

      {info.category === 'userGuide' && <PrevNextFooter topicKey={topicKey} />}

      {/* Design-review F-19: this shipped as a permanently-disabled
          "(coming soon)" stub long after the templates landed. Wired to the
          same path as CanvasEmbed's "Take to canvas". */}
      {info.category === 'howto' && info.howtoTemplate && (
        <div style={{ marginTop: 28 }}>
          <button
            type="button"
            data-testid="wiki-howto-load"
            data-howto-template={info.howtoTemplate}
            onClick={async () => {
              try {
                const res = await fetch(`/templates/howto/${info.howtoTemplate}.json`);
                if (!res.ok) return;
                const data = await res.json();
                const s = (await import('../../store')).useStore.getState();
                s.replaceGraph({ nodes: data.nodes, edges: data.edges }, { layout: 'auto' });
                s.setAppMode('freeform');
                s.closeWiki();
                s.setAppView('canvas');
              } catch {
                // Leave the user on the docs page; the embed's own button still works.
              }
            }}
            style={{
              padding: '10px 18px',
              borderRadius: 6,
              background: 'var(--accent)',
              color: 'white',
              border: 'none',
              fontSize: 14,
              letterSpacing: '-0.12px',
              cursor: 'pointer',
            }}
          >
            Load in canvas
          </button>
        </div>
      )}
    </article>
  );
}
