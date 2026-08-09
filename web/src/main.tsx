import React from 'react';
import { createRoot } from 'react-dom/client';
import { installWebPorts, primeOnFirstGesture } from './ports';
import App from './App';
import './index.css';

// Ports must be registered before any store action runs — core throws a clear
// error rather than silently no-opping if this is skipped.
installWebPorts();
primeOnFirstGesture();

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
