import { useEffect, useState, useRef } from 'react';

interface UndoToastProps {
  message: string;
  onDismiss: () => void;
}

export default function UndoToast({ message, onDismiss }: UndoToastProps) {
  const [visible, setVisible] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    let fadeTimer: ReturnType<typeof setTimeout>;
    const autoTimer = setTimeout(() => {
      setVisible(false);
      fadeTimer = setTimeout(() => dismissRef.current(), 200);
    }, 4000);
    return () => {
      clearTimeout(autoTimer);
      clearTimeout(fadeTimer!);
    };
  }, []);

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-lg transition-all duration-200"
      style={{
        background: 'var(--bg-card)',
        padding: '10px 20px',
        boxShadow: 'var(--shadow-elevated)',
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? '0' : '8px'})`,
      }}
    >
      <span style={{ fontSize: '14px', color: 'var(--text-tertiary)', letterSpacing: '-0.224px' }}>
        {message}
      </span>
    </div>
  );
}
