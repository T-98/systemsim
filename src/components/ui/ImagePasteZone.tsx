import { useCallback, useRef, type ReactNode } from 'react';
import { ALLOWED_IMAGE_MIMES, isAllowedMime } from '../../util/imageResize';

interface ImagePasteZoneProps {
  onImage: (file: File) => void;
  onError: (message: string) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Wraps a region so that:
 *   - Cmd+V with a clipboard image fires `onImage`
 *   - Files dragged in are ignored (drag-drop is FOLLOWUP scope)
 *   - Paste that doesn't contain an image is silently ignored
 *
 * The file-picker button lives elsewhere; this component only owns paste and render.
 */
export default function ImagePasteZone({ onImage, onError, disabled, children, className }: ImagePasteZoneProps) {
  const zoneRef = useRef<HTMLDivElement | null>(null);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (!file) continue;
        if (!isAllowedMime(file.type)) {
          onError(`Image format not supported. Use PNG, JPEG, or WebP.`);
          e.preventDefault();
          return;
        }
        onImage(file);
        e.preventDefault();
        return;
      }
    },
    [disabled, onImage, onError]
  );

  return (
    <div ref={zoneRef} onPaste={handlePaste} className={className}>
      {children}
    </div>
  );
}

export function acceptAttr(): string {
  return ALLOWED_IMAGE_MIMES.join(',');
}
