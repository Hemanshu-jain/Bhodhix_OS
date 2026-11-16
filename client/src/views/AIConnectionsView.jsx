import React, { useEffect, useState } from 'react';
import { Bot, Check, Copy, ExternalLink, Hash, Link2, LockKeyhole, PlugZap, ShieldCheck, Trash2, Unplug } from 'lucide-react';
import { useVault } from '../context/VaultContext';

export default function AIConnectionsView() {
  const { apiFetch, projectList } = useVault();
  const [endpoint, setEndpoint] = useState(() => new URL('/mcp', window.location.origin).href);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [slack, setSlack] = useState(null);
  const [slackChannels, setSlackChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [slackBusy, setSlackBusy] = useState(false);
  const [slackError, setSlackError] = useState('');
  const [slackNotice, setSlackNotice] = useState('');
  const [routingEvents, setRoutingEvents] = useState([]);
  const [projectChannels, setProjectChannels] = useState({});
  const [accountProviders, setAccountProviders] = useState([]);
  const [accountRedirectUri, setAccountRedirectUri] = useState('');
  const [desktopOAuth, setDesktopOAuth] = useState(false);
  const [accountBusy, setAccountBusy] = useState('');
  const [accountNotice, setAccountNotice] = useState('');
  const [accountError, setAccountError] = useState('');

  const loadSlack = async () => {
    try {
      const response = await apiFetch('/api/slack/status');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not load Slack status.');
      setSlack(data);
      setSelectedChannel(data.channelId || '');
      setRoutingEvents(data.events || []);
      setProjectChannels(data.projectChannels || {});
      if (data.connected) {
        const channelResponse = await apiFetch('/api/slack/channels');
        const channelData = await channelResponse.json();
        if (!channelResponse.ok || !channelData.success) throw new Error(channelData.error || 'Could not load Slack channels.');
        setSlackChannels(channelData.channels || []);
      } else setSlackChannels([]);
      setSlackError('');
    } catch (err) {
      setSlackError(err.message || 'Could not load Slack status.');
      setSlack((current) => current || { configured: false, canConnect: false, connected: false, setupMessage: err.message || 'Slack status is unavailable.' });
    }
  };

  const loadAccounts = async () => {
    try {
      const response = await apiFetch('/api/integrations/accounts');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not load account connections');
      setAccountProviders(data.providers || []);
      setAccountRedirectUri(data.redirectUri || '');
      setDesktopOAuth(Boolean(data.desktopMode));
      setAccountError('');
    } catch (error) { setAccountError(error.message || 'Could not load account connections'); }
  };

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/api/ai/connections');
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The AI connector API is not available in the running engine. Restart Bhodhix OS, then refresh this page.');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not load AI connections.');
      setEndpoint(data.endpoint);
      setConnections(data.connections || []);
      setError('');
    } catch (err) { setError(err.message || 'Could not load AI connections.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const refreshAccounts = () => loadAccounts();
    const callbackResult = new URLSearchParams(window.location.search).get('slack');
    if (callbackResult) {
      setSlackNotice(callbackResult === 'connected' ? 'Slack workspace connected.' : 'Slack connection did not finish. Please try again.');
      window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
    }
    const accountResult = new URLSearchParams(window.location.search).get('account');
    if (accountResult) {
      setAccountNotice(accountResult.endsWith('-connected') ? `${accountResult.startsWith('google') ? 'Google' : 'Microsoft'} account connected.` : 'Account connection did not finish.');
      window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
    }
    load();
    loadSlack();
    loadAccounts();
    window.addEventListener('focus', refreshAccounts);
    return () => window.removeEventListener('focus', refreshAccounts);
  }, []);

  const connectAccount = async (provider) => {
    setAccountBusy(provider); setAccountError('');
    try {
      const response = await apiFetch(`/api/integrations/accounts/${provider}/connect`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.success || !data.authorizationUrl) throw new Error(data.error || 'Could not begin account connection');
      window.location.assign(data.authorizationUrl);
      setAccountBusy('');
    } catch (error) { setAccountError(error.message || 'Could not begin account connection'); setAccountBusy(''); }
  };

  const disconnectAccount = async (provider) => {
    setAccountBusy(provider); setAccountError('');
    try {
      const response = await apiFetch(`/api/integrations/accounts/${provider}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not disconnect account');
      await loadAccounts(); setAccountNotice('Account disconnected from Bhodhix.');
    } catch (error) { setAccountError(error.message || 'Could not disconnect account'); }
    finally { setAccountBusy(''); }
  };

  const connectSlack = async () => {
    setSlackBusy(true); setSlackError('');
    try {
      const response = await apiFetch('/api/slack/connect', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.success || !data.authorizationUrl) throw new Error(data.error || 'Could not start Slack authorization.');
      window.location.assign(data.authorizationUrl);
    } catch (err) { setSlackError(err.message || 'Could not connect Slack.'); setSlackBusy(false); }
  };

  const saveSlackChannel = async () => {
    setSlackBusy(true); setSlackError('');
    try {
      const response = await apiFetch('/api/slack/channel', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: selectedChannel }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not save the Slack channel.');
      setSlack((current) => ({ ...current, channelId: data.channelId, channelName: data.channelName }));
      setSlackNotice(`Default channel saved: #${data.channelName}`);
    } catch (err) { setSlackError(err.message || 'Could not save the Slack channel.'); }
    finally { setSlackBusy(false); }
  };

  const sendSlackTest = async () => {
    setSlackBusy(true); setSlackError('');
    try {
      const response = await apiFetch('/api/slack/test-message', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not send a Slack test message.');
      setSlackNotice(`Test message sent to #${data.channelName}.`);
    } catch (err) { setSlackError(err.message || 'Could not send a Slack test message.'); }
    finally { setSlackBusy(false); }
  };

  const saveSlackRouting = async () => {
    setSlackBusy(true); setSlackError('');
    try {
      const response = await apiFetch('/api/slack/routing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: routingEvents, projectChannels }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not save Slack routing.');
      setSlack((current) => ({ ...current, events: data.events, projectChannels: data.projectChannels }));
      setSlackNotice('Slack notification routing saved.');
    } catch (err) { setSlackError(err.message || 'Could not save Slack routing.'); }
    finally { setSlackBusy(false); }
  };

  const disconnectSlack = async () => {
    if (!window.confirm(`Disconnect ${slack?.teamName || 'this Slack workspace'} from Bhodhix?`)) return;
    setSlackBusy(true); setSlackError('');
    try {
      const response = await apiFetch('/api/slack/connection', { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.disconnected) throw new Error(data.error || 'Could not disconnect Slack.');
      setSlack((current) => ({ ...current, connected: false, teamName: '', channelId: '', channelName: '' }));
      setSlackChannels([]); setSelectedChannel(''); setSlackNotice('Slack workspace disconnected.');
    } catch (err) { setSlackError(err.message || 'Could not disconnect Slack.'); }
    finally { setSlackBusy(false); }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { setError('Clipboard access is unavailable. Select the endpoint and copy it.'); }
  };

  const revoke = async (connection) => {
    if (!window.confirm(`Disconnect ${connection.name} from your workspace?`)) return;
    try {
      const response = await apiFetch(`/api/ai/connections/${encodeURIComponent(connection.id)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.revoked) throw new Error(data.error || 'Could not disconnect this AI app.');
      setConnections((items) => items.filter((item) => item.id !== connection.id));
    } catch (err) { setError(err.message || 'Could not disconnect this AI app.'); }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 space-y-6 max-w-[1600px] w-full mx-auto">
      <header className="border-b border-bhodix-border pb-5">
        <div className="flex items-center gap-2 text-indigo-500"><PlugZap className="w-5 h-5" /><span className="text-[10px] font-mono uppercase tracking-widest">Integrations</span></div>
        <h1 className="mt-2 text-2xl font-bold text-bhodix-text tracking-tight">Integrations & Connectors</h1>
        <p className="mt-1 text-xs text-bhodix-textMuted">Connect ChatGPT, Claude, Slack, and other external services to your Bhodhix workspace.</p>
      </header>

      <section className="rounded-2xl border border-bhodix-border bg-bhodix-card p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-indigo-500/10 p-2 text-indigo-400"><Link2 className="w-5 h-5" /></div>
          <div><h2 className="text-sm font-semibold text-bhodix-text">Workspace MCP endpoint</h2><p className="mt-1 text-xs text-bhodix-textMuted">Use this URL when adding Bhodhix as a custom connector. Sign in with your workspace email and password, then review the access requested by the AI app.</p></div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input aria-label="MCP endpoint" readOnly value={endpoint} onFocus={(event) => event.target.select()} className="min-w-0 flex-1 rounded-lg border border-bhodix-border bg-bhodix-surface px-3 py-2 font-mono text-xs text-bhodix-text" />
          <button onClick={copy} disabled={!endpoint || loading} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copied' : 'Copy URL'}</button>
        </div>
        {endpoint.startsWith('http://') && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">This local HTTP endpoint is for local development. Cloud AI services require public HTTPS; configure <code>PUBLIC_BASE_URL</code>, a reachable server binding, and a TLS reverse proxy first.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-4"><div className="flex items-center gap-2 text-sm font-semibold text-bhodix-text"><Bot className="w-4 h-4 text-emerald-400" />ChatGPT</div><ol className="mt-3 list-decimal space-y-1 pl-4 text-xs text-bhodix-textMuted"><li>Open Plugins in ChatGPT and choose Add custom MCP server. Availability and admin permissions depend on your plan.</li><li>Paste this endpoint, select OAuth, then create and test the connection.</li><li>Review the requested Bhodhix permissions before approving.</li></ol><a href="https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">ChatGPT setup guide <ExternalLink className="w-3 h-3" /></a></div>
          <div className="rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-4"><div className="flex items-center gap-2 text-sm font-semibold text-bhodix-text"><Bot className="w-4 h-4 text-orange-300" />Claude</div><ol className="mt-3 list-decimal space-y-1 pl-4 text-xs text-bhodix-textMuted"><li>Open Settings → Connectors and add a custom connector. Team and Enterprise workspaces may require an owner to add it.</li><li>Paste this endpoint, select Add, then connect with OAuth.</li><li>Review the requested Bhodhix permissions before approving.</li></ol><a href="https://support.anthropic.com/en/articles/11175166-about-custom-integrations-using-remote-mcp" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">Claude setup guide <ExternalLink className="w-3 h-3" /></a></div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex gap-2 rounded-lg bg-bhodix-surface p-3 text-xs text-bhodix-textMuted"><ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" /><span>Task changes require a separate write permission you can decline.</span></div>
          <div className="flex gap-2 rounded-lg bg-bhodix-surface p-3 text-xs text-bhodix-textMuted"><LockKeyhole className="w-4 h-4 shrink-0 text-indigo-400" /><span>Each assistant gets a separate, revocable grant.</span></div>
          <div className="flex gap-2 rounded-lg bg-bhodix-surface p-3 text-xs text-bhodix-textMuted"><ExternalLink className="w-4 h-4 shrink-0 text-indigo-400" /><span>AI services receive workspace content only when you use them.</span></div>
        </div>
        <p className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 text-[11px] text-bhodix-textMuted">Read access is requested by default. Task changes appear only when the AI client requests the task-write permission and you approve it. Reconnect an existing assistant if you want to grant that permission.</p>
      </section>

      <section className="rounded-2xl border border-bhodix-border bg-bhodix-card p-5 space-y-4">
        <div><h2 className="text-sm font-semibold text-bhodix-text">Mail and calendar accounts</h2><p className="mt-1 text-xs text-bhodix-textMuted">Connect a personal account for new-mail alerts and upcoming-meeting reminders. Bhodhix requests read-only access.</p></div>
        {accountNotice && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-300">{accountNotice}</p>}
        {accountError && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">{accountError}</p>}
        <div className="grid gap-3 md:grid-cols-2">{accountProviders.map((provider) => <article key={provider.id} className="rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-bhodix-text">{provider.name}</h3><p className="mt-1 text-[11px] text-bhodix-textSubtle">{provider.connected ? provider.email || 'Connected account' : 'Gmail / Calendar or Outlook / Calendar'}</p></div><span className={`rounded-full px-2 py-1 text-[9px] ${provider.connected ? 'bg-emerald-500/10 text-emerald-300' : provider.configured ? 'bg-indigo-500/10 text-indigo-300' : 'bg-amber-500/10 text-amber-200'}`}>{provider.connected ? 'Connected' : provider.configured ? 'Ready' : 'Setup needed'}</span></div>{provider.error && <p className="mt-2 text-[10px] text-amber-200">{provider.error}</p>}<div className="mt-3">{provider.connected ? <button onClick={() => disconnectAccount(provider.id)} disabled={accountBusy === provider.id} className="rounded-lg border border-rose-500/30 px-3 py-2 text-xs text-rose-300 disabled:opacity-50">{accountBusy === provider.id ? 'Disconnecting…' : 'Disconnect account'}</button> : <button onClick={() => connectAccount(provider.id)} disabled={!provider.configured || accountBusy === provider.id} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{accountBusy === provider.id ? 'Connecting…' : `Connect ${provider.name}`}</button>}</div></article>)}</div>
        {!accountProviders.length && <p className="text-xs text-bhodix-textSubtle">Loading account providers…</p>}
        <p className="rounded-lg border border-bhodix-borderSubtle p-3 text-[10px] text-bhodix-textSubtle">{desktopOAuth ? 'Configure a Google Desktop app client (ID and client value) or enable public client flow for Microsoft, then add this local callback URI to the provider app:' : 'Configure Google and Microsoft web client IDs/secrets, then register this hosted callback URI with both providers:'} <code className="break-all">{accountRedirectUri || new URL('/api/integrations/oauth/callback', window.location.origin).href}</code>. Emails are checked for headers only; message bodies are not read or stored. Account alerts are checked once a minute while the Bhodhix server is running.</p>
      </section>

      <section className="rounded-2xl border border-bhodix-border bg-bhodix-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3"><div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-400"><Hash className="w-5 h-5" /></div><div><h2 className="text-sm font-semibold text-bhodix-text">Slack workspace</h2><p className="mt-1 text-xs text-bhodix-textMuted">Connect one Slack workspace, choose a default channel, and send a test message.</p></div></div>
          {slack?.connected && <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-300">Connected</span>}
        </div>
        {slackNotice && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-300">{slackNotice}</p>}
        {slackError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300"><span>{slackError}</span><button onClick={loadSlack} className="rounded-md border border-rose-400/30 px-3 py-1.5 font-semibold hover:bg-rose-500/10">Retry</button></div>}
        {!slack ? <p className="text-xs text-bhodix-textSubtle">Loading Slack connection…</p> : slack.connected ? <>
          <div className="rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-4"><p className="text-xs text-bhodix-textMuted">Connected workspace</p><p className="mt-1 text-sm font-semibold text-bhodix-text">{slack.teamName}</p><p className="mt-1 text-[11px] text-bhodix-textSubtle">Connected {slack.connectedAt ? new Date(slack.connectedAt).toLocaleDateString() : ''}. Bhodhix only requests permission to post messages and list public channels where its bot is a member.</p></div>
          <div className="flex flex-col gap-2 sm:flex-row"><select aria-label="Default Slack channel" value={selectedChannel} onChange={(event) => setSelectedChannel(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-bhodix-border bg-bhodix-surface px-3 py-2 text-xs text-bhodix-text"><option value="">Choose a channel</option>{slackChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select><button onClick={saveSlackChannel} disabled={slackBusy || !selectedChannel || selectedChannel === slack.channelId} className="rounded-lg border border-bhodix-border px-3 py-2 text-xs font-semibold text-bhodix-textMuted hover:bg-bhodix-hover disabled:opacity-40">Save channel</button><button onClick={sendSlackTest} disabled={slackBusy || !slack.channelId} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40">Send test message</button></div>
          {!slackChannels.length && <p className="text-[11px] text-amber-200">Invite the Bhodhix bot to a public Slack channel, then reload the channel list.</p>}
          <div className="rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-4 space-y-3"><div><h3 className="text-xs font-semibold text-bhodix-text">Slack event routing</h3><p className="mt-1 text-[11px] text-bhodix-textSubtle">Only task titles, project names, status changes, and incident titles are sent. Descriptions, comments, and credentials stay in Bhodhix.</p></div><div className="flex flex-wrap gap-2">{[['task.created', 'New tasks'], ['task.status', 'Task status changes'], ['incident.logged', 'Logged incidents']].map(([id, label]) => <label key={id} className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-bhodix-border px-3 py-2 text-xs text-bhodix-textMuted"><input type="checkbox" checked={routingEvents.includes(id)} onChange={(event) => setRoutingEvents((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} className="accent-indigo-500" />{label}</label>)}</div>{projectList.map((project) => <label key={project.id} className="flex flex-wrap items-center gap-2 text-[11px] text-bhodix-textMuted"><span className="min-w-28 flex-1">{project.name}</span><select aria-label={`Slack channel for ${project.name}`} value={projectChannels[project.id] || ''} onChange={(event) => setProjectChannels((current) => ({ ...current, [project.id]: event.target.value }))} className="min-w-[12rem] flex-1 rounded-lg border border-bhodix-border bg-bhodix-card px-3 py-2 text-xs text-bhodix-text"><option value="">Use default channel</option>{slackChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select></label>)}<button onClick={saveSlackRouting} disabled={slackBusy} className="rounded-lg border border-bhodix-border px-3 py-2 text-xs font-semibold text-bhodix-textMuted hover:bg-bhodix-hover disabled:opacity-40">Save routing</button></div>
          <div className="flex flex-wrap justify-between gap-3"><p className="text-[11px] text-bhodix-textSubtle">Project channels override the default channel. Slack notifications are sent only for the event types enabled above.</p><button onClick={disconnectSlack} disabled={slackBusy} className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 px-3 py-2 text-xs text-rose-400 hover:bg-rose-500/10 disabled:opacity-40"><Unplug className="w-3.5 h-3.5" />Disconnect</button></div>
        </> : slack.canConnect ? <>
          <p className="rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-4 text-xs text-bhodix-textMuted">Authorize Bhodhix to post messages in Slack and list public channels where the bot has been invited. You can disconnect it at any time.</p>
          <button onClick={connectSlack} disabled={slackBusy} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{slackBusy ? 'Starting Slack…' : 'Connect Slack'}</button>
        </> : <div className="space-y-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4"><p className="text-xs text-amber-200">{slack.setupMessage || 'Slack connection is not available yet.'}</p><p className="text-[11px] text-bhodix-textMuted">An administrator must create a Slack app, set its OAuth redirect URL to <code className="break-all">{window.location.origin}/api/slack/oauth/callback</code>, add bot scopes <code>chat:write</code> and <code>channels:read</code>, configure the three Slack server settings, and restart Bhodhix. Slack OAuth requires the public HTTPS app URL.</p></div>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-bhodix-border bg-bhodix-card">
        <div className="border-b border-bhodix-border px-5 py-4"><h2 className="text-sm font-semibold text-bhodix-text">Connected assistants</h2><p className="mt-1 text-xs text-bhodix-textSubtle">Permissions are shown per assistant. Revoking access takes effect on the next request.</p></div>
        {error && <div role="alert" className="mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300"><span>{error}</span><button onClick={load} className="rounded-md border border-rose-400/30 px-3 py-1.5 font-semibold hover:bg-rose-500/10">Retry status</button></div>}
        {loading ? <p className="p-5 text-xs text-bhodix-textSubtle">Loading connections…</p> : connections.length ? <div className="divide-y divide-bhodix-borderSubtle">{connections.map((connection) => <div key={connection.id} className="flex flex-wrap items-center gap-3 px-5 py-4"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-400"><Bot className="w-4 h-4" /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-bhodix-text">{connection.name}</div><div className="text-[11px] text-bhodix-textSubtle">Connected {new Date(connection.createdAt).toLocaleDateString()} · {connection.scopes?.includes('bhodhix:task.write') ? 'Read + task changes' : 'Read-only'}</div></div><button onClick={() => revoke(connection)} className="inline-flex items-center gap-2 rounded-lg border border-bhodix-border px-3 py-2 text-xs text-rose-400 hover:bg-rose-500/10"><Trash2 className="w-3.5 h-3.5" />Disconnect</button></div>)}</div> : !error && <p className="p-5 text-xs text-bhodix-textSubtle">No assistants connected yet.</p>}
      </section>
    </div>
  );
}
