import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const openProject = new URLSearchParams(window.location.search).get('openProject');
const openTask = new URLSearchParams(window.location.search).get('openTask');
if (openProject && openTask) {
  try { localStorage.setItem('bhodix_task_to_open', JSON.stringify({ projectId: openProject, taskId: openTask })); } catch { /* storage unavailable */ }
  const url = new URL(window.location.href);
  url.searchParams.delete('openProject');
  url.searchParams.delete('openTask');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (event) => {
  if (event.data?.type === 'bhodhix:open-task' && event.data.projectId && event.data.taskId) {
    window.dispatchEvent(new CustomEvent('bhodhix:open-task', { detail: { projectId: event.data.projectId, taskId: event.data.taskId } }));
  }
});

window.bhodhixDesktop?.onNotificationAction((event) => {
  if (event.action === 'open_task' && event.data?.projectId && event.data?.taskId) {
    window.dispatchEvent(new CustomEvent('bhodhix:open-task', { detail: { projectId: event.data.projectId, taskId: event.data.taskId } }));
  }
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
