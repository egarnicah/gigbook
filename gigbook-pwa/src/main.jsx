import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';   // musician-pwa.jsx renombrado a App.jsx

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Ocultar splash una vez que React monta
if (typeof window.__gigbookReady === 'function') {
  window.__gigbookReady();
}
