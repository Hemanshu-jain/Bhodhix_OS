import React, { useEffect, useState } from 'react';
import { Layers, Lock, ShieldCheck, ArrowRight, Sun, Moon, AlertCircle, Mail, Key } from 'lucide-react';
import { useVault } from '../context/VaultContext';

export default function LoginView() {
  const { login, theme, toggleTheme } = useVault();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [activeServerUrl, setActiveServerUrl] = useState('');
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverBusy, setServerBusy] = useState(false);
  const [serverMessage, setServerMessage] = useState('');
  const desktop = window.bhodhixDesktop;

  useEffect(() => { desktop?.getServerUrl?.().then((url) => { setActiveServerUrl(url); setServerUrl(url); }).catch(() => {}); }, []);

  const changeServer = async (event) => {
    event.preventDefault(); setServerBusy(true); setServerMessage('');
    try {
      const result = await desktop.setServerUrl(serverUrl.trim());
      if (!result.success) setServerMessage(result.error || 'Could not connect to this server.');
      else setServerMessage('Connected. Opening the workspace…');
    } catch { setServerMessage('Could not change the company server connection.'); }
    finally { setServerBusy(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await login({ email: email.trim(), password });
      if (!res.success) {
        setError(res.error || 'Invalid email or password');
        setSubmitting(false);
      }
    } catch {
      setError('Unable to connect to the Bhodhix engine. Please ensure the server is running.');
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] w-screen flex-col justify-between bg-bhodix-bg p-4 text-bhodix-text transition-colors select-none md:p-6">
      {/* Top Header */}
      <div className="flex items-center justify-between max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <span className="font-bold text-sm tracking-wide">Bhodhix OS</span>
            <span className="text-[11px] text-bhodix-textSubtle ml-2 font-mono">Command Center</span>
          </div>
        </div>
        <button
          onClick={toggleTheme}
          type="button"
          className="p-2 rounded-lg bg-bhodix-surface hover:bg-bhodix-hover border border-bhodix-border text-bhodix-textMuted hover:text-bhodix-text transition-colors flex items-center gap-1.5 text-xs font-mono"
          title="Toggle Theme"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-400" />}
          <span className="capitalize">{theme} Mode</span>
        </button>
      </div>

      {/* Main Login Card */}
      <div className="max-w-md w-full mx-auto my-auto space-y-6">
        <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-8 shadow-xl shadow-indigo-950/10 space-y-6">
          <div className="space-y-2 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600/10 border border-indigo-500/30 text-indigo-400 mb-2">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-bhodix-text">
              Sign in to Bhodhix OS
            </h1>
            <p className="text-xs text-bhodix-textMuted max-w-xs mx-auto">
              Enter your work email and password to access your workspace.
            </p>
          </div>

          {error && (
            <div role="alert" className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-bhodix-textMuted">Work Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-bhodix-textSubtle pointer-events-none" />
                <input
                  aria-label="Work email"
                  required
                  type="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@bhodhix.com"
                  autoComplete="email"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-bhodix-surface border border-bhodix-border text-bhodix-text text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-bhodix-textMuted">Password</label>
              <div className="relative">
                <Key className="w-4 h-4 absolute left-3 top-3 text-bhodix-textSubtle pointer-events-none" />
                <input
                  aria-label="Password"
                  required
                  type="password"
                  maxLength={256}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-bhodix-surface border border-bhodix-border text-bhodix-text text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || !email.trim() || !password}
              className="w-full mt-2 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{submitting ? 'Signing in…' : 'Sign in'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

        {desktop && <div className="rounded-xl border border-bhodix-border bg-bhodix-card px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-bhodix-textMuted">{activeServerUrl && !['http://127.0.0.1', 'http://localhost', 'http://[::1]'].some((local) => activeServerUrl.startsWith(local)) ? `Company server · ${new URL(activeServerUrl).host}` : 'This device · local workspace'}</span><button type="button" onClick={() => { setShowServerSettings((value) => !value); setServerMessage(''); }} className="font-medium text-indigo-400 hover:text-indigo-300">{showServerSettings ? 'Close' : 'Connect to a company server'}</button></div>
          {showServerSettings && <form onSubmit={changeServer} className="mt-3 space-y-2"><p className="text-[11px] text-bhodix-textSubtle">Enter the secure HTTPS address provided by your workspace administrator.</p><input type="url" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="https://planner.company.com" className="w-full rounded-lg border border-bhodix-border bg-bhodix-surface px-3 py-2 text-xs text-bhodix-text placeholder:text-bhodix-textSubtle focus:border-indigo-500 focus:outline-none"/><div className="flex flex-wrap gap-2"><button type="submit" disabled={serverBusy || !serverUrl.trim()} className="rounded-lg bg-indigo-600 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-50">{serverBusy ? 'Connecting…' : 'Connect'}</button>{activeServerUrl && !['http://127.0.0.1', 'http://localhost', 'http://[::1]'].some((local) => activeServerUrl.startsWith(local)) && <button type="button" disabled={serverBusy} onClick={async () => { setServerBusy(true); const result = await desktop.setServerUrl(''); setServerBusy(false); setServerMessage(result.success ? 'Switching to this device…' : result.error); }} className="rounded-lg border border-bhodix-border px-3 py-2 text-[11px] text-bhodix-text">Use this device</button>}</div>{serverMessage && <p role="status" className="text-[11px] text-bhodix-textMuted">{serverMessage}</p>}</form>}
        </div>}

        {/* Footer Security Badge */}
        <div className="flex items-center justify-center gap-2 text-[11px] font-mono text-bhodix-textSubtle">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Authenticated Core · Bhodhix Softwares LLP</span>
        </div>
      </div>

      <div className="text-center text-[11px] font-mono text-bhodix-textSubtle">
        Bhodhix OS Engine v1.0
      </div>
    </div>
  );
}
