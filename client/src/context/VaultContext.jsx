import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const VaultContext = createContext(null);

export function VaultProvider({ children }) {
  const [vault, setVault] = useState(null);
  const [health, setHealth] = useState({ endpoints: [], metrics: {}, incidents: [], databases: [], meta: {} });
  const [loading, setLoading] = useState(true);
  const [setupComplete, setSetupComplete] = useState(true);
  const [teamMembers, setTeamMembers] = useState([]);
  const [connected, setConnected] = useState(false);
  const [selectedProject, setSelectedProjectState] = useState(() => localStorage.getItem('bhodix_project') || 'all'); // 'all' or a project id
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [hasUnsavedDocChanges, setHasUnsavedDocChanges] = useState(false);

  const setSelectedProject = (projectId) => {
    setSelectedProjectState(projectId);
    try { localStorage.setItem('bhodix_project', projectId); } catch { /* storage unavailable */ }
  };

  // Theme Management ('dark' | 'light')
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('bhodix_theme') || 'dark';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('bhodix_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Auth sessions are individual; the bootstrap PIN is only used for the first owner account.
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('bhodix_auth');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });
  const tokenRef = useRef(user?.token || '');
  tokenRef.current = user?.token || '';

  const logout = () => {
    if (tokenRef.current) fetch('/api/auth/logout', { method: 'POST', headers: { 'x-bhodix-token': tokenRef.current } }).catch(() => {});
    setUser(null);
    try { localStorage.removeItem('bhodix_auth'); } catch (e) { /* storage unavailable */ }
  };

  const apiFetch = async (url, options = {}) => {
    const res = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), 'x-bhodix-token': tokenRef.current }
    });
    if (res.status === 401 && tokenRef.current) logout();
    return res;
  };

  const authenticate = async (url, payload) => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success && data.verificationRequired) {
        if (url === '/api/setup/owner') setSetupComplete(true);
        return { success: true, verificationRequired: true, email: data.email };
      }
      if (data.success && data.requiresWorkspace) return { success: true, requiresWorkspace: true, workspaces: data.workspaces || [] };
      if (!data.success) return { success: false, error: data.error || 'Login failed' };
      const userData = { token: data.token, ...data.user };
      setUser(userData);
      if (userData.organization?.slug && userData.email) {
        try { localStorage.setItem(`bhodhix_last_workspace_${userData.email.toLowerCase()}`, userData.organization.slug); } catch { /* storage unavailable */ }
      }
      if (url === '/api/setup/owner') setSetupComplete(true);
      try { localStorage.setItem('bhodix_auth', JSON.stringify(userData)); } catch (e) { /* storage unavailable */ }
      return { success: true };
    } catch (err) {
      return { success: false, error: 'Cannot reach the Bhodhix engine. Is the server running?' };
    }
  };
  const login = (credentials) => authenticate('/api/login', credentials);
  const signup = (credentials) => authenticate('/api/signup', credentials);
  const setupOwner = (credentials) => authenticate('/api/setup/owner', credentials);
  const joinTeam = (credentials) => authenticate('/api/join', credentials);
  const requestAuthEmail = async (url, email) => {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const data = await res.json();
      return res.ok && data.success ? { success: true, message: data.message } : { success: false, error: data.error || 'Could not send the email.' };
    } catch { return { success: false, error: 'Cannot reach the Bhodhix engine. Is the server running?' }; }
  };
  const resendVerification = (email) => requestAuthEmail('/api/auth/resend-verification', email);
  const requestPasswordReset = (email) => requestAuthEmail('/api/auth/request-password-reset', email);

  useEffect(() => {
    fetch('/api/setup/status').then((res) => res.json()).then((data) => setSetupComplete(!!data.setupComplete)).catch(() => {});
  }, []);

  const fetchTeam = async () => {
    try {
      const res = await apiFetch('/api/team');
      const data = await res.json();
      if (data.success) setTeamMembers(data.members);
    } catch { /* team data can be refreshed on the next sign in */ }
  };

  const teamRequest = async (url, method = 'GET', body) => {
    try {
      const res = await apiFetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const data = await res.json();
      if (!data.success) return { success: false, error: data.error };
      await fetchTeam();
      return data;
    } catch { return { success: false, error: 'Could not reach the server' }; }
  };

  // Fetch initial data
  const fetchVault = async () => {
    try {
      const res = await apiFetch('/api/vault');
      const data = await res.json();
      if (data.success) {
        setVault(data.data);
        setLastSyncTime(new Date().toLocaleTimeString());
      }
    } catch (err) {
      console.error('Failed to fetch vault state:', err);
    }
  };

  const fetchHealth = async () => {
    try {
      const res = await apiFetch('/api/monitoring/status');
      const data = await res.json();
      if (data.success) {
        setHealth(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch health status:', err);
    }
  };

  const token = user?.token || '';

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    apiFetch('/api/auth/me').then((res) => res.json()).then((data) => {
      if (data.success) {
        const userData = { ...data.user, token };
        setUser(userData);
        try { localStorage.setItem('bhodix_auth', JSON.stringify(userData)); } catch { /* storage unavailable */ }
      }
    }).catch(() => {});
    fetchTeam();
    fetchVault().finally(() => setLoading(false));
    fetchHealth();

    // Real-time reactivity over Server-Sent Events
    const eventSource = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    const updateDatabaseStatus = (event) => setHealth((prev) => ({ ...prev, ...(event.detail || {}) }));
    window.addEventListener('bhodhix:database-status', updateDatabaseStatus);

    eventSource.onopen = () => setConnected(true);

    eventSource.addEventListener('vault_update', (e) => {
      try {
        setVault(JSON.parse(e.data));
        setLastSyncTime(new Date().toLocaleTimeString());
      } catch (err) {
        console.error('Error parsing vault_update event:', err);
      }
    });

    eventSource.addEventListener('health_update', (e) => {
      try {
        const updatedHealth = JSON.parse(e.data);
        setHealth(prev => ({ ...prev, metrics: updatedHealth.metrics || prev.metrics }));
      } catch (err) {
        console.error('Error parsing health_update event:', err);
      }
    });

    eventSource.addEventListener('database_update', (e) => {
      try { setHealth((prev) => ({ ...prev, databases: JSON.parse(e.data) })); } catch { /* ignore malformed events */ }
    });

    eventSource.addEventListener('server_notification', (e) => {
      try { window.dispatchEvent(new CustomEvent('bhodhix:server-notification', { detail: JSON.parse(e.data) })); } catch { /* ignore malformed events */ }
    });

    eventSource.addEventListener('task_activity_update', (e) => {
      try { window.dispatchEvent(new CustomEvent('bhodix:task-activity-update', { detail: JSON.parse(e.data) })); } catch { /* ignore malformed events */ }
    });

    eventSource.onerror = () => setConnected(false);

    return () => { eventSource.close(); window.removeEventListener('bhodhix:database-status', updateDatabaseStatus); };
  }, [token]);

  // Update task status in markdown
  const updateTaskStatus = async (projectId, taskId, newStatus, note) => {
    try {
      const res = await apiFetch('/api/tasks/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectId, taskId, status: newStatus, note })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return true;
    } catch (err) {
      console.error('Failed to update task status:', err);
      return false;
    }
  };

  // Toggle subtask checkbox
  const toggleSubtask = async (projectId, taskId, subtaskText, completed) => {
    try {
      const res = await apiFetch('/api/tasks/toggle-subtask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectId, taskId, subtaskText, completed })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return true;
    } catch (err) {
      console.error('Failed to toggle subtask:', err);
      return false;
    }
  };

  // Create new task
  const createTask = async (projectId, taskData) => {
    try {
      const res = await apiFetch('/api/tasks/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectId, task: taskData })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return true;
    } catch (err) {
      console.error('Failed to create task:', err);
      return false;
    }
  };

  const deleteTask = async (projectId, taskId, reason) => {
    try {
      const res = await apiFetch('/api/tasks/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: projectId, taskId, reason }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return true;
    } catch (err) { console.error('Failed to delete task:', err); return false; }
  };

  const getDeletedTasks = async () => {
    try {
      const res = await apiFetch('/api/tasks/trash');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.tasks || [];
    } catch (err) { console.error('Failed to load deleted tasks:', err); return null; }
  };

  const restoreTask = async (projectId, taskId) => {
    try {
      const res = await apiFetch('/api/tasks/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: projectId, taskId }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return true;
    } catch (err) { console.error('Failed to restore task:', err); return false; }
  };

  // Save file content back to disk
  const saveFile = async (relativePath, content) => {
    try {
      const res = await apiFetch('/api/vault/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: relativePath, content })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return true;
    } catch (err) {
      console.error('Failed to save file:', err);
      return false;
    }
  };

  // Trigger manual health check
  const triggerHealthCheck = async () => {
    try {
      const res = await apiFetch('/api/monitoring/check-now', { method: 'POST' });
      const data = await res.json();
      fetchHealth();
      return data;
    } catch (err) {
      console.error('Failed to run health check:', err);
    }
  };

  // Header refresh: re-read the vault from disk (not just the server's memory) and re-probe endpoints.
  const refreshAll = async () => {
    try {
      const res = await apiFetch('/api/vault/reload', { method: 'POST' });
      const data = await res.json();
      if (!data.success) return false;
      setVault(data.data);
      setLastSyncTime(new Date().toLocaleTimeString());
      await triggerHealthCheck();
      return true;
    } catch (err) {
      console.error('Failed to refresh:', err);
      return false;
    }
  };

  // Project Management
  const createProject = async (projectData) => {
    try {
      const res = await apiFetch('/api/projects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectData)
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await fetchVault();
      return { success: true, project: data.project };
    } catch (err) {
      console.error('Failed to create project:', err);
      return { success: false, error: err.message };
    }
  };

  const deleteProject = async (projectId) => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await fetchVault();
      return true;
    } catch (err) {
      console.error('Failed to delete project:', err);
      return false;
    }
  };

  const updateProjectMetadata = async (projectId, update) => {
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/metadata`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update)
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await fetchVault();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  // Feature Management
  const createFeature = async (projectId, featureData) => {
    try {
      const res = await apiFetch('/api/features/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectId, feature: featureData })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await fetchVault();
      return true;
    } catch (err) {
      console.error('Failed to create feature:', err);
      return false;
    }
  };

  // Finance Management (Revenue & Expense)
  const addRevenue = async (projectId, revenueData) => {
    try {
      const res = await apiFetch('/api/finances/revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectId, revenue: revenueData })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await fetchVault();
      return true;
    } catch (err) {
      console.error('Failed to add revenue stream:', err);
      return false;
    }
  };

  const addExpense = async (projectId, expenseData) => {
    try {
      const res = await apiFetch('/api/finances/expense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectId, expense: expenseData })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await fetchVault();
      return true;
    } catch (err) {
      console.error('Failed to add expense:', err);
      return false;
    }
  };

  // Company-level (non-project) expense -> shared overhead in the consolidated ledger
  const addOverhead = async (expenseData) => {
    try {
      const res = await apiFetch('/api/finances/overhead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expense: expenseData })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await fetchVault();
      return true;
    } catch (err) {
      console.error('Failed to add company expense:', err);
      return false;
    }
  };

  // Monitoring Endpoints & Incidents
  const addEndpoint = async (endpointData) => {
    try {
      const res = await apiFetch('/api/monitoring/endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(endpointData)
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await fetchHealth();
      await fetchVault();
      return true;
    } catch (err) {
      console.error('Failed to add endpoint:', err);
      return false;
    }
  };

  const addIncident = async (incidentData) => {
    try {
      const res = await apiFetch('/api/monitoring/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(incidentData)
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await fetchHealth();
      await fetchVault();
      return true;
    } catch (err) {
      console.error('Failed to log incident:', err);
      return false;
    }
  };

  // Global modal state
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);

  // Helper to aggregate all tasks across projects
  const getAllTasks = () => {
    if (!vault || !vault.projects) return [];
    let list = [];
    Object.keys(vault.projects).forEach(projKey => {
      const proj = vault.projects[projKey];
      if (selectedProject === 'all' || selectedProject === projKey) {
        if (proj.tasks && Array.isArray(proj.tasks)) {
          list = list.concat(proj.tasks);
        }
      }
    });
    return list;
  };

  const companyName = vault?.company?.metadata?.company || '';
  const legalName = vault?.company?.metadata?.legal_name || '';

  const projectKeys = vault?.projects ? Object.keys(vault.projects) : [];
  const projectList = projectKeys.map(id => ({
    id,
    name: vault.projects[id].meta?.name || id,
    shortName: vault.projects[id].meta?.short_name || id
  }));

  // Launch date comes from vault/company.md (target_launch_date), never hardcoded.
  const rawLaunch = vault?.company?.metadata?.target_launch_date;
  const launchStr = rawLaunch ? String(rawLaunch).slice(0, 10) : '';
  const launchTime = /^\d{4}-\d{2}-\d{2}$/.test(launchStr) ? new Date(`${launchStr}T00:00:00`).getTime() : null;
  const daysToLaunch = launchTime === null ? null : Math.ceil((launchTime - Date.now()) / 86400000);

  return (
    <VaultContext.Provider
      value={{
        vault,
        health,
        loading,
        connected,
        theme,
        toggleTheme,
        user,
        isAuthenticated: !!user,
        login,
        signup,
        setupOwner,
        joinTeam,
        resendVerification,
        requestPasswordReset,
        setupComplete,
        teamMembers,
        teamRequest,
        logout,
        selectedProject,
        setSelectedProject,
        hasUnsavedDocChanges,
        setHasUnsavedDocChanges,
        projectKeys,
        companyName,
        legalName,
        projectList,
        apiFetch,
        launchTime,
        launchStr,
        daysToLaunch,
        isCreateProjectOpen,
        setIsCreateProjectOpen,
        createProject,
        deleteProject,
        updateProjectMetadata,
        createFeature,
        addRevenue,
        addExpense,
        addOverhead,
        refreshAll,
        addEndpoint,
        addIncident,
        lastSyncTime,
        updateTaskStatus,
        toggleSubtask,
        createTask,
        deleteTask,
        getDeletedTasks,
        restoreTask,
        saveFile,
        triggerHealthCheck,
        getAllTasks,
        refreshVault: fetchVault
      }}
    >
      {children}
    </VaultContext.Provider>
  );
}

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used within VaultProvider');
  return ctx;
}
