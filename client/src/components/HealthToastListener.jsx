import { useEffect, useRef } from 'react';
import { useToast } from './ToastProvider';
import { useVault } from '../context/VaultContext';

// Toasts only when an endpoint's status changes, not on every 20s sweep.
export default function HealthToastListener() {
  const { showToast } = useToast();
  const { health } = useVault();
  const lastStatus = useRef({});

  useEffect(() => {
    const metrics = health?.metrics;
    if (!metrics) return;

    Object.entries(metrics).forEach(([id, metric]) => {
      const previous = lastStatus.current[id];
      const current = metric.currentStatus;
      lastStatus.current[id] = current;
      if (previous === current) return;
      if (localStorage.getItem('bhodix_health_alerts') === 'false') return;

      if (current === 'down') showToast(`Critical: ${metric.name} is DOWN`, 'error');
      else if (current === 'degraded') showToast(`Warning: ${metric.name} is degraded`, 'info');
      else if (current === 'operational' && (previous === 'down' || previous === 'degraded')) {
        showToast(`Recovered: ${metric.name} is back up`, 'info');
      }
    });
  }, [health, showToast]);

  return null; // Pure logic component
}
