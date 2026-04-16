/**
 * @file components/nodes/icons.tsx
 *
 * Per-component-type SVG icons. Kept inline (not imported from a lib) so
 * they're tree-shakeable and themeable via currentColor.
 */

import type { ComponentType } from '../../types';

const iconProps = { width: 24, height: 24, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 };

export function ComponentIcon({ type }: { type: ComponentType }) {
  switch (type) {
    case 'load_balancer':
      return (
        <svg {...iconProps} viewBox="0 0 24 24">
          <path d="M12 3v4m0 0l-6 4m6-4l6 4M6 11v6l6 4 6-4v-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'api_gateway':
      return (
        <svg {...iconProps} viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 3v18" strokeLinecap="round" />
        </svg>
      );
    case 'server':
      return (
        <svg {...iconProps} viewBox="0 0 24 24">
          <rect x="2" y="3" width="20" height="7" rx="1" />
          <rect x="2" y="14" width="20" height="7" rx="1" />
          <circle cx="6" cy="6.5" r="1" fill="currentColor" />
          <circle cx="6" cy="17.5" r="1" fill="currentColor" />
        </svg>
      );
    case 'cache':
      return (
        <svg {...iconProps} viewBox="0 0 24 24">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinejoin="round" />
        </svg>
      );
    case 'queue':
      return (
        <svg {...iconProps} viewBox="0 0 24 24">
          <rect x="2" y="6" width="5" height="12" rx="1" />
          <rect x="9.5" y="6" width="5" height="12" rx="1" />
          <rect x="17" y="6" width="5" height="12" rx="1" />
          <path d="M7 12h2.5M14.5 12h2.5" strokeLinecap="round" />
        </svg>
      );
    case 'database':
      return (
        <svg {...iconProps} viewBox="0 0 24 24">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 5v14c0 1.66-4.03 3-9 3s-9-1.34-9-3V5" />
          <path d="M21 12c0 1.66-4.03 3-9 3s-9-1.34-9-3" />
        </svg>
      );
    case 'websocket_gateway':
      return (
        <svg {...iconProps} viewBox="0 0 24 24">
          <path d="M4 4l4 4m0-4l-4 4M20 20l-4-4m4 0l-4 4" strokeLinecap="round" />
          <path d="M8 8l8 8" strokeLinecap="round" strokeDasharray="2 2" />
        </svg>
      );
    case 'fanout':
      return (
        <svg {...iconProps} viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="2" />
          <circle cx="19" cy="5" r="2" />
          <circle cx="19" cy="12" r="2" />
          <circle cx="19" cy="19" r="2" />
          <path d="M7 12h10M7 11l10-6M7 13l10 6" strokeLinecap="round" />
        </svg>
      );
    case 'cdn':
      return (
        <svg {...iconProps} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2c-3 3.6-3 16.4 0 20M12 2c3 3.6 3 16.4 0 20" />
        </svg>
      );
    case 'external':
      return (
        <svg {...iconProps} viewBox="0 0 24 24">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'autoscaler':
      return (
        <svg {...iconProps} viewBox="0 0 24 24">
          <path d="M16 3h5v5M8 21H3v-5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}
