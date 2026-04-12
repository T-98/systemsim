import { useEffect, useState } from 'react';

interface UndoToastProps {
  message: string;
  onDismiss: () => void;
}

export default function UndoToast({ message, onDismiss }: UndoToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 200);
    }, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

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
