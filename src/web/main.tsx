import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme/tokens.css';

// View Transitions tuning is not needed for the first paint: load it beside the
// entry chunk (static import would add ~0.5 kB gzip to the first-screen budget).
void import('./lib/motion').then((motion) => {
  motion.markViewTransitionSupport();
  motion.installViewTransitionTuning();
});

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
