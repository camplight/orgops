import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { App } from './screens/App';
import { DocsRedirect } from './screens/DocsRedirect';

function Router() {
  const path = window.location.pathname;
  if (path === '/docs' || path === '/docs/') return <DocsRedirect />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>
);
