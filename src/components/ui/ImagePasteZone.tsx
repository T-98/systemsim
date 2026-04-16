/**
 * @file components/ui/ImagePasteZone.tsx
 *
 * Handles image paste (Cmd+V), drag-drop, and file picker. Resizes to 1568px
 * longest edge as JPEG via util/imageResize before passing to the caller as
 * a base64 data URL.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
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
 *   - An image file dragged onto the zone fires `onImage`
 *   - Non-image paste/drop is rejected with a friendly message
 *   - Children render above a tinted drop-overlay while drag is hovering
 */
export default function ImagePasteZone({ onImage, onError, disabled, children, className }: ImagePasteZoneProps) {
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);

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

  const handleDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragActive(true);
    },
    [disabled]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      if (!isAllowedMime(file.type)) {
        onError('Image format not supported. Use PNG, JPEG, or WebP.');
        return;
      }
      onImage(file);
    },
    [disabled, onImage, onError]
  );

  return (
    <div
      ref={zoneRef}
      onPaste={handlePaste}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={className}
      style={{ position: 'relative' }}
    >
      {children}
      {dragActive && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl"
          style={{
            background: 'var(--accent-ring)',
            border: '2px dashed var(--accent)',
            borderRadius: 11,
            zIndex: 2,
          }}
        >
          <span
            style={{
              fontSize: 14,
              color: 'var(--accent)',
              letterSpacing: '-0.224px',
              fontWeight: 600,
            }}
          >
            Drop image to attach
          </span>
        </div>
      )}
    </div>
  );
}

export function acceptAttr(): string {
  return ALLOWED_IMAGE_MIMES.join(',');
}
