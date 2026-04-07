import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useStore } from './store';
import './index.css';

// Expose store for debugging/testing
(window as any).__store = useStore;

// Initialize theme class on document root
const initialTheme = useStore.getState().theme;
document.documentElement.classList.toggle('dark', initialTheme === 'dark');

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
