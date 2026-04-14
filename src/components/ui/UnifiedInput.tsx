import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { describeIntent, type DescribeIntentResult } from '../../ai/describeIntent';
import { resizeImage, isAllowedMime } from '../../util/imageResize';
import ImagePasteZone, { acceptAttr } from './ImagePasteZone';
import ImagePreviewChip from './ImagePreviewChip';

const PROGRESS_MESSAGES = [
  'Reading your description...',
  'Understanding intent...',
  'Building spec...',
];

const MIN_CHARS = 15;
const MAX_CHARS = 10000;

interface StagedImage {
  file: File;
  base64: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: number;
  filename: string;
  previewUrl: string;
}

export default function UnifiedInput() {
  const setReviewState = useStore((s) => s.setReviewState);
  const setLandingInput = useStore((s) => s.setLandingInput);
  const setAppView = useStore((s) => s.setAppView);
  const setAppMode = useStore((s) => s.setAppMode);
  const setScenarioId = useStore((s) => s.setScenarioId);
  const landingInput = useStore((s) => s.landingInput);

  const [text, setText] = useState<string>(landingInput?.text ?? '');
  const [image, setImage] = useState<StagedImage | null>(() => {
    if (!landingInput?.image) return null;
    return {
      file: new File([], landingInput.image.filename ?? 'image'),
      base64: landingInput.image.base64,
      mimeType: landingInput.image.mimeType,
      bytes: landingInput.image.bytes,
      filename: landingInput.image.filename ?? 'image',
      previewUrl: '',
    };
  });
  const [busy, setBusy] = useState<'idle' | 'resizing' | 'submitting'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progressIdx, setProgressIdx] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const charCount = text.length;
  const showCharWarning = charCount > 8000;
  const hasValidText = text.trim().length >= MIN_CHARS;
  const canSubmit = (hasValidText || !!image) && busy === 'idle';

  const disabledReason = !canSubmit && busy === 'idle'
    ? (text.trim().length === 0 && !image
        ? 'Describe your system or attach an image'
        : `Needs at least ${MIN_CHARS} characters or an image`)
    : undefined;

  const startProgress = useCallback(() => {
    setProgressIdx(0);
    progressTimer.current = setInterval(() => {
      setProgressIdx((i) => (i + 1) % PROGRESS_MESSAGES.length);
    }, 1500);
  }, []);
  const stopProgress = useCallback(() => {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopProgress();
      if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
    };
  }, [image?.previewUrl, stopProgress]);

  const handleFile = useCallback(async (file: File) => {
    if (!isAllowedMime(file.type)) {
      setError('Image format not supported. Use PNG, JPEG, or WebP.');
      return;
    }
    setError(null);
    setBusy('resizing');
    try {
      const resized = await resizeImage(file);
      if (!resized.ok) {
        const msg =
          resized.error.kind === 'file_too_large'
            ? 'That image is too large. Try one under 10MB.'
            : resized.error.kind === 'unsupported_format'
              ? 'Image format not supported. Use PNG, JPEG, or WebP.'
              : "Couldn't read that image. Try a different file.";
        setError(msg);
        setBusy('idle');
        return;
      }
      if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
      const previewUrl = URL.createObjectURL(file);
      const staged: StagedImage = {
        file,
        base64: resized.base64,
        mimeType: 'image/jpeg',
        bytes: resized.bytes,
        filename: file.name || 'pasted-image.png',
        previewUrl,
      };
      setImage(staged);
      setBusy('idle');
    } catch {
      setError("Couldn't process that image.");
      setBusy('idle');
    }
  }, [image?.previewUrl]);

  const handleRemoveImage = useCallback(() => {
    if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
    setImage(null);
  }, [image?.previewUrl]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;

    const thisRequest = ++requestId.current;
    setBusy('submitting');
    setError(null);
    startProgress();

    const controller = new AbortController();
    abortRef.current = controller;

    const landingSnapshot = {
      text: hasValidText ? text.trim() : undefined,
      image: image
        ? {
            base64: image.base64,
            mimeType: image.mimeType,
            bytes: image.bytes,
            filename: image.filename,
          }
        : undefined,
    };
    setLandingInput(landingSnapshot);

    const result: DescribeIntentResult = await describeIntent({
      text: hasValidText ? text.trim() : undefined,
      imageBase64: image?.base64,
      mimeType: image?.mimeType,
      signal: controller.signal,
    });

    if (requestId.current !== thisRequest) return;

    stopProgress();
    abortRef.current = null;

    if (result.ok) {
      setReviewState({ data: result.data, sourceInput: landingSnapshot });
      setAppMode('freeform');
      setScenarioId(null);
      setAppView('review');
    } else if (result.kind !== 'aborted') {
      const msg =
        result.kind === 'rate_limit'
          ? 'Rate limited. Wait a moment and try again.'
          : result.kind === 'network'
            ? "Can't reach the service. Check your connection."
            : result.kind === 'validation'
              ? result.message
              : 'AI took too long to respond. Try again, or paste a smaller/simpler image.';
      setError(msg);
    }

    setBusy('idle');
  }, [canSubmit, hasValidText, text, image, startProgress, stopProgress, setReviewState, setLandingInput, setAppMode, setScenarioId, setAppView]);

  const handleCancel = useCallback(() => {
    requestId.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    stopProgress();
    setBusy('idle');
  }, [stopProgress]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
    const submitModifier = isMac ? e.metaKey : e.ctrlKey;
    if (submitModifier && e.key === 'Enter' && canSubmit) {
      e.preventDefault();
      void handleSubmit();
    }
  }, [canSubmit, handleSubmit]);

  const handlePasteError = useCallback((msg: string) => setError(msg), []);

  const submitting = busy === 'submitting';
  const resizing = busy === 'resizing';

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <label
          htmlFor="system-description"
          className="font-semibold"
          style={{ fontSize: 14, color: 'var(--text-primary)', letterSpacing: '-0.224px' }}
        >
          Describe your system
        </label>
      </div>

      <ImagePasteZone onImage={handleFile} onError={handlePasteError} disabled={submitting}>
        <div
          className="rounded-xl transition-colors"
          style={{
            background: 'var(--bg-input)',
            border: '1px solid var(--border-color)',
            borderRadius: 11,
            padding: '12px 12px 10px',
          }}
        >
          <textarea
            id="system-description"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build, or paste/upload a Miro screenshot."
            maxLength={MAX_CHARS}
            rows={4}
            readOnly={submitting}
            aria-label="System description"
            className="w-full resize-none bg-transparent outline-none"
            style={{
              color: 'var(--text-primary)',
              fontSize: 14,
              letterSpacing: '-0.224px',
              lineHeight: 1.5,
              opacity: submitting ? 0.6 : 1,
            }}
          />
          <div className="flex items-center justify-between mt-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting || resizing}
              aria-label="Attach image"
              className="inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-30"
              style={{
                width: 32,
                height: 32,
                color: 'var(--text-tertiary)',
                background: 'transparent',
              }}
              onMouseEnter={(e) => {
                if (!submitting && !resizing) {
                  e.currentTarget.style.color = 'var(--accent)';
                  e.currentTarget.style.background = 'var(--bg-hover)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-tertiary)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept={acceptAttr()}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = '';
              }}
            />

            {!submitting ? (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                title={disabledReason}
                className="rounded-lg font-medium transition-all disabled:opacity-30"
                style={{
                  padding: '6px 16px',
                  fontSize: 14,
                  letterSpacing: '-0.224px',
                  background: 'var(--accent)',
                  color: 'var(--text-on-accent)',
                }}
              >
                {resizing ? 'Preparing…' : 'Generate'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-lg font-medium transition-all"
                style={{
                  padding: '6px 16px',
                  fontSize: 14,
                  letterSpacing: '-0.224px',
                  background: 'var(--bg-card)',
                  color: 'var(--text-tertiary)',
                  border: '1px solid var(--border-color)',
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </ImagePasteZone>

      {image && (
        <div className="mt-3">
          <ImagePreviewChip
            filename={image.filename}
            bytes={image.bytes}
            onRemove={handleRemoveImage}
            disabled={submitting}
          />
        </div>
      )}

      {submitting && (
        <div
          className="mt-3 flex items-center gap-2"
          role="status"
          aria-live="polite"
          style={{ fontSize: 13, color: 'var(--text-tertiary)', letterSpacing: '-0.224px' }}
        >
          <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          {PROGRESS_MESSAGES[progressIdx]}
        </div>
      )}

      {showCharWarning && (
        <p style={{ fontSize: 12, color: 'var(--warning)', letterSpacing: '-0.12px', marginTop: 4 }}>
          Long description. The AI will focus on the core architecture.
        </p>
      )}

      {error && (
        <div
          className="mt-3 rounded-lg p-3"
          style={{ background: 'rgba(255,69,58,0.08)', border: '1px solid rgba(255,69,58,0.2)' }}
          role="alert"
        >
          <p style={{ fontSize: 13, color: '#ff453a', letterSpacing: '-0.224px' }}>{error}</p>
        </div>
      )}

      <p
        className="mt-2"
        style={{ fontSize: 12, color: 'var(--text-tertiary)', letterSpacing: '-0.12px', opacity: 0.7 }}
      >
        Your description is sent to Anthropic's AI service. Don't include passwords, API keys, or confidential info.
      </p>
    </div>
  );
}
