import React, { useEffect, useState } from 'react';
import {
  CircleDollarSign,
  TrendingUp,
  Server,
  PieChart as PieIcon,
  Calendar,
  ArrowUpRight,
  CheckCircle2,
  Layers,
  CreditCard,
  Building,
  Plus
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { useToast } from '../components/ToastProvider';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  Legend 
} from 'recharts';

export default function FinanceView() {
  const { vault, selectedProject, setSelectedProject, projectList, addRevenue, addExpense, addOverhead, companyName } = useVault();
  const { showToast } = useToast();

  // Quick entry: a project, or the company itself (shared overheads, no revenue).
  const COMPANY = '__company';
  const [qTarget, setQTarget] = useState(selectedProject === 'all' ? '' : selectedProject);
  const [qName, setQName] = useState('');
  const [qAmount, setQAmount] = useState('');
  const target = qTarget || (selectedProject !== 'all' ? selectedProject : projectList[0]?.id) || COMPANY;

  useEffect(() => { setQTarget(selectedProject === 'all' ? '' : selectedProject); }, [selectedProject]);

  const submitQuick = async (kind) => {
    if (!qName.trim() || !qAmount || Number(qAmount) <= 0) {
      showToast('Enter a name and an amount greater than zero', 'error');
      return;
    }
    let ok;
    if (target === COMPANY) ok = await addOverhead({ service: qName, cost: qAmount });
    else if (kind === 'revenue') ok = await addRevenue(target, { client: qName, amount: qAmount });
    else ok = await addExpense(target, { item: qName, cost: qAmount });
    showToast(ok ? 'Saved to ledger' : 'Could not save', ok ? 'success' : 'error');
    if (ok) { setQName(''); setQAmount(''); }
  };
  const [activeFinanceTab, setActiveFinanceTab] = useState(selectedProject === 'all' ? 'consolidated' : selectedProject);
  const [revenueChange, setRevenueChange] = useState(0);
  const [costChange, setCostChange] = useState(0);
  const [cashAvailable, setCashAvailable] = useState('');
  const [budget, setBudget] = useState(() => { try { return JSON.parse(localStorage.getItem('bhodix_finance_budget') || '{}'); } catch { return {}; } });
  useEffect(() => {
    if (selectedProject === 'all' && activeFinanceTab !== 'compare') setActiveFinanceTab('consolidated');
    else if (projectList.some((project) => project.id === selectedProject)) setActiveFinanceTab(selectedProject);
  }, [selectedProject, projectList, activeFinanceTab]);

  const bhodixLedger = vault?.finances || {};
  const meta = bhodixLedger.meta || {};
  const tables = bhodixLedger.tables || {};
  const activeProject = activeFinanceTab !== 'consolidated' ? projectList.find((p) => p.id === activeFinanceTab) : null;

  const formatINR = (val) => {
    if (val === null || val === undefined || val === '') return '—';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(Number(val) || 0);
  };

  // Bar chart data for cash flows
  const barData = (tables.cashFlowHistory || []).map(row => ({
    month: row.month,
    Revenue: parseInt(row.total_revenue__inr_ || '0', 10),
    Costs: parseInt(row.total_costs__inr_ || '0', 10),
    Profit: parseInt(row.net_profit__inr_ || '0', 10)
  }));

  const exportCsv = () => {
    const rows = [['Month', 'Revenue INR', 'Costs INR', 'Profit INR'], ...barData.map((row) => [row.month, row.Revenue, row.Costs, row.Profit])];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'bhodhix-finance-report.csv'; link.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto transition-colors">
      {/* Finance Mode Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-bhodix-border pb-4">
        <div>
          <h1 className="text-xl font-bold text-bhodix-text tracking-tight flex items-center gap-2">
            Finance & Unit Economics Engine
          </h1>
          <p className="text-xs text-bhodix-textMuted mt-0.5">
            Institutional revenue tracking, infra burn, and per-app gross margins
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2"><button onClick={exportCsv} disabled={!barData.length} className="rounded-lg border border-bhodix-border bg-bhodix-card px-3 py-2 text-xs text-bhodix-textMuted hover:text-indigo-500 disabled:opacity-40">Export cash flow CSV</button><div className="flex flex-wrap items-center bg-bhodix-card border border-bhodix-border rounded-xl p-0.5 text-xs font-medium">
          {[{ id: 'consolidated', label: 'Bhodhix Consolidated' }, { id: 'compare', label: 'Compare Apps' }, ...projectList.map((p) => ({ id: p.id, label: `${p.name} Unit P&L` }))].map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveFinanceTab(tab.id); setSelectedProject(tab.id === 'compare' || tab.id === 'consolidated' ? 'all' : tab.id); }}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeFinanceTab === tab.id
                  ? 'bg-indigo-600 text-white font-medium shadow-sm'
                  : 'text-bhodix-textMuted hover:text-bhodix-text'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div></div>
      </div>

      {/* Quick entry: any project, or the company itself */}
      <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-4 shadow-sm flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs font-bold text-bhodix-text shrink-0">
          <Plus className="w-4 h-4 text-indigo-500" />
          <span>Quick Entry</span>
        </div>
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-3">
          <select
            value={target}
            onChange={(e) => setQTarget(e.target.value)}
            className="p-2 rounded-lg bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-text outline-none focus:border-indigo-500"
          >
            {projectList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value={COMPANY}>{companyName || 'Company'} (company expense)</option>
          </select>
          <input
            required
            value={qName}
            onChange={(e) => setQName(e.target.value)}
            placeholder={target === COMPANY ? 'Service / item' : 'Client / item'}
            className="p-2 rounded-lg bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-text outline-none focus:border-indigo-500"
          />
          <input
            type="number"
            min="1"
            step="1"
            required
            value={qAmount}
            onChange={(e) => setQAmount(e.target.value)}
            placeholder="Monthly amount (INR)"
            className="p-2 rounded-lg bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-text outline-none focus:border-indigo-500"
          />
          <div className="flex gap-2">
            {target !== COMPANY && (
              <button
                onClick={() => submitQuick('revenue')}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold rounded-lg transition-colors"
              >
                + Revenue
              </button>
            )}
            <button
              onClick={() => submitQuick('expense')}
              className="flex-1 py-2 bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold rounded-lg transition-colors"
            >
              + Expense
            </button>
          </div>
        </div>
      </div>

      {activeFinanceTab === 'compare' && (
        <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-6 shadow-sm overflow-x-auto">
          <h2 className="text-sm font-bold text-bhodix-text mb-4">Project finance comparison</h2>
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead><tr className="border-b border-bhodix-border text-bhodix-textSubtle uppercase font-mono"><th className="pb-3">Project</th><th className="pb-3">Monthly inflow</th><th className="pb-3">Monthly burn</th><th className="pb-3">Net margin</th><th className="pb-3">Margin %</th></tr></thead>
            <tbody className="divide-y divide-bhodix-borderSubtle">
              {projectList.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-bhodix-textSubtle">No projects to compare.</td></tr>}
              {projectList.map((project) => {
                const finance = vault?.projects?.[project.id]?.finances?.meta || {};
                return <tr key={project.id}><td className="py-3 font-semibold text-bhodix-text">{project.name}</td><td className="py-3 font-mono">{formatINR(finance.monthly_gross_revenue)}</td><td className="py-3 font-mono">{formatINR(finance.monthly_total_expenses)}</td><td className="py-3 font-mono">{formatINR(finance.net_monthly_margin)}</td><td className="py-3 font-mono">{finance.net_margin_percentage === null || finance.net_margin_percentage === undefined || finance.net_margin_percentage === '' ? '—' : `${finance.net_margin_percentage}%`}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeFinanceTab === 'consolidated' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-bhodix-border bg-bhodix-card p-5 shadow-sm">
            <h2 className="text-sm font-bold text-bhodix-text">What-if monthly scenario</h2>
            <p className="mt-1 text-[11px] text-bhodix-textMuted">Explore changes locally. This does not edit the ledger or predict cash runway.</p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="text-xs text-bhodix-textMuted">Revenue change <span className="font-mono text-indigo-500">{revenueChange}%</span><input aria-label="Revenue change percent" type="range" min="-50" max="100" value={revenueChange} onChange={(e) => setRevenueChange(Number(e.target.value))} className="mt-2 block w-full accent-indigo-500" /></label>
              <label className="text-xs text-bhodix-textMuted">Cost change <span className="font-mono text-rose-500">{costChange}%</span><input aria-label="Cost change percent" type="range" min="-50" max="100" value={costChange} onChange={(e) => setCostChange(Number(e.target.value))} className="mt-2 block w-full accent-rose-500" /></label>
            </div>
            {(() => {
              const revenue = Number(meta.consolidated_mrr) || 0;
              const costs = Number(meta.total_monthly_expenses) || 0;
              const projectedRevenue = Math.round(revenue * (1 + revenueChange / 100));
              const projectedCosts = Math.round(costs * (1 + costChange / 100));
              const monthlyBurn = projectedCosts - projectedRevenue;
              const runway = Number(cashAvailable) > 0 && monthlyBurn > 0 ? `${(Number(cashAvailable) / monthlyBurn).toFixed(1)} months` : Number(cashAvailable) > 0 && monthlyBurn <= 0 ? 'Cashflow positive' : 'Enter available cash';
              return <><div className="mt-4 grid grid-cols-3 gap-3 border-t border-bhodix-border pt-4 text-center"><div><div className="text-[10px] uppercase text-bhodix-textSubtle">Revenue</div><div className="mt-1 text-sm font-bold text-bhodix-text">{formatINR(projectedRevenue)}</div></div><div><div className="text-[10px] uppercase text-bhodix-textSubtle">Costs</div><div className="mt-1 text-sm font-bold text-bhodix-text">{formatINR(projectedCosts)}</div></div><div><div className="text-[10px] uppercase text-bhodix-textSubtle">Net</div><div className={`mt-1 text-sm font-bold ${monthlyBurn <= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatINR(projectedRevenue - projectedCosts)}</div></div></div><label className="mt-4 block text-[10px] text-bhodix-textMuted">Cash available for runway estimate<input type="number" min="0" value={cashAvailable} onChange={(e) => setCashAvailable(e.target.value)} placeholder="Enter cash balance (INR)" className="mt-1 w-full rounded-lg border border-bhodix-border bg-bhodix-surface px-3 py-2 text-xs text-bhodix-text" /></label><div className="mt-2 text-xs text-bhodix-textMuted">Scenario runway: <strong className="text-bhodix-text">{runway}</strong> <span className="text-[10px]">(simple cash ÷ monthly deficit estimate)</span></div></>;
            })()}
          </section>
          <section className="rounded-2xl border border-bhodix-border bg-bhodix-card p-5 shadow-sm"><h2 className="text-sm font-bold text-bhodix-text">Cash flow and monthly comparison</h2><p className="mt-1 text-[11px] text-bhodix-textMuted">Reported history from the ledger. The local budget below stays in this browser.</p><div className="mt-3 grid grid-cols-2 gap-3"><label className="text-[10px] text-bhodix-textMuted">Monthly revenue budget<input type="number" min="0" value={budget.revenue ?? ''} onChange={(e) => { const next = { ...budget, revenue: e.target.value }; setBudget(next); try { localStorage.setItem('bhodix_finance_budget', JSON.stringify(next)); } catch { /* storage unavailable */ } }} className="mt-1 w-full rounded-lg border border-bhodix-border bg-bhodix-surface px-2 py-1.5 text-xs text-bhodix-text" /></label><label className="text-[10px] text-bhodix-textMuted">Monthly cost budget<input type="number" min="0" value={budget.costs ?? ''} onChange={(e) => { const next = { ...budget, costs: e.target.value }; setBudget(next); try { localStorage.setItem('bhodix_finance_budget', JSON.stringify(next)); } catch { /* storage unavailable */ } }} className="mt-1 w-full rounded-lg border border-bhodix-border bg-bhodix-surface px-2 py-1.5 text-xs text-bhodix-text" /></label></div>{barData.length > 0 && (budget.revenue !== undefined || budget.costs !== undefined) && <div className="mt-2 rounded-lg bg-bhodix-surface p-2 text-[10px] text-bhodix-textMuted">Latest recorded month ({barData[barData.length - 1].month}): Revenue variance {budget.revenue === undefined ? '—' : formatINR(barData[barData.length - 1].Revenue - Number(budget.revenue))} · Cost variance {budget.costs === undefined ? '—' : formatINR(barData[barData.length - 1].Costs - Number(budget.costs))}</div>}<div className="mt-3 max-h-40 overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-bhodix-card text-[10px] uppercase text-bhodix-textSubtle"><tr><th className="py-2">Month</th><th>Revenue</th><th>Costs</th><th>Net</th></tr></thead><tbody>{barData.map((row) => <tr key={row.month} className="border-t border-bhodix-borderSubtle"><td className="py-2 text-bhodix-text">{row.month}</td><td className="font-mono text-bhodix-textMuted">{formatINR(row.Revenue)}</td><td className="font-mono text-bhodix-textMuted">{formatINR(row.Costs)}</td><td className={`font-mono ${row.Profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatINR(row.Profit)}</td></tr>)}</tbody></table>{!barData.length && <p className="py-8 text-center text-xs text-bhodix-textSubtle">No monthly history available.</p>}</div></section>
        </div>
      )}

      {/* CONSOLIDATED VIEW */}
      {activeFinanceTab === 'consolidated' && (
        <div className="space-y-6">
          {/* Top Level Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-5 space-y-2 shadow-sm">
              <span className="text-[11px] font-mono text-bhodix-textSubtle uppercase">Consolidated MRR</span>
              <div className="text-2xl font-bold font-mono text-bhodix-text">
                {formatINR(meta.consolidated_mrr)}
              </div>
              <div className="text-[11px] text-emerald-500 dark:text-emerald-400 font-mono">
                ARR: {formatINR(meta.consolidated_arr)}
              </div>
            </div>

            <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-5 space-y-2 shadow-sm">
              <span className="text-[11px] font-mono text-bhodix-textSubtle uppercase">Total Monthly Burn</span>
              <div className="text-2xl font-bold font-mono text-bhodix-text">
                {formatINR(meta.total_monthly_expenses)}
              </div>
              <div className="text-[11px] text-bhodix-textSubtle font-mono">
                Shared Cloud & APIs
              </div>
            </div>

            <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-5 space-y-2 shadow-sm">
              <span className="text-[11px] font-mono text-bhodix-textSubtle uppercase">Net Monthly Profit</span>
              <div className="text-2xl font-bold font-mono text-bhodix-text">
                {formatINR(meta.net_monthly_profit)}
              </div>
              <div className="text-[11px] text-indigo-500 dark:text-indigo-400 font-mono">
                Margin: {meta.net_margin_percentage === null || meta.net_margin_percentage === undefined || meta.net_margin_percentage === '' ? '—' : `${meta.net_margin_percentage}%`}
              </div>
            </div>

            <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-5 space-y-2 shadow-sm">
              <span className="text-[11px] font-mono text-bhodix-textSubtle uppercase">Runway Buffer</span>
              <div className="text-2xl font-bold font-mono text-bhodix-text">
                {meta.cash_runway_months === null || meta.cash_runway_months === undefined || meta.cash_runway_months === '' ? '—' : `${meta.cash_runway_months} Months`}
              </div>
              <div className="text-[11px] text-emerald-500 dark:text-emerald-400 font-mono">
                {meta.net_monthly_profit > 0 ? 'Cashflow Positive' : 'Set cash_runway_months in the ledger'}
              </div>
            </div>
          </div>

          {/* Bar Chart: Historical & Projected Growth */}
          <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-6 space-y-4 shadow-sm">
            <h2 className="text-sm font-bold text-bhodix-text tracking-tight">
              Consolidated Revenue vs Operational Burn
            </h2>
            {barData.length === 0 && (
              <div className="py-10 text-center text-xs text-bhodix-textSubtle font-mono">
                No cash-flow rows yet. Add monthly rows to the ledger's cash-flow table.
              </div>
            )}
            <div className={`h-64 w-full pt-3 ${barData.length === 0 ? 'hidden' : ''}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--bhodix-border)" vertical={false} />
                  <XAxis dataKey="month" stroke="var(--bhodix-text-subtle)" fontSize={11} tickLine={false} />
                  <YAxis 
                    stroke="var(--bhodix-text-subtle)" 
                    fontSize={11} 
                    tickLine={false} 
                    axisLine={false}
                    tickFormatter={(val) => `₹${val / 1000}k`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'var(--bhodix-surface)', 
                      borderColor: 'var(--bhodix-border)', 
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: 'var(--bhodix-text)'
                    }}
                    formatter={(val) => [`₹${Number(val).toLocaleString('en-IN')}`, '']}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar dataKey="Revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Profit" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Costs" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* App Contribution Breakdown Table */}
          <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-6 space-y-4 shadow-sm">
            <h2 className="text-sm font-bold text-bhodix-text tracking-tight">
              Per-App Revenue & Margin Contribution
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-bhodix-border text-bhodix-textSubtle font-mono text-[11px] uppercase">
                    <th className="pb-3">Product / App</th>
                    <th className="pb-3">Inflow (MRR)</th>
                    <th className="pb-3">Direct Infra Burn</th>
                    <th className="pb-3">Net Contribution</th>
                    <th className="pb-3">Gross Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bhodix-borderSubtle">
                  {!tables.contributions?.length && (
                    <tr><td colSpan={5} className="py-6 text-center text-bhodix-textSubtle font-mono">Nothing recorded yet.</td></tr>
                  )}
                  {tables.contributions?.map((c, idx) => (
                    <tr key={idx} className="hover:bg-bhodix-surface/40">
                      <td className="py-3 font-semibold text-bhodix-text">{String(c.product___app ?? '').replace(/\*\*/g, '')}</td>
                      <td className="py-3 font-mono text-indigo-500 dark:text-indigo-400 font-medium">{String(c.inflow__mrr_ ?? '').replace(/\*\*/g, '')}</td>
                      <td className="py-3 font-mono text-rose-500 font-medium">{String(c.direct_infra_burn ?? '').replace(/\*\*/g, '')}</td>
                      <td className="py-3 font-mono text-emerald-500 dark:text-emerald-400 font-bold">{String(c.net_contribution ?? '').replace(/\*\*/g, '')}</td>
                      <td className="py-3 font-mono text-bhodix-text">{String(c.margin__ ?? '').replace(/\*\*/g, '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Shared SaaS Overheads Table */}
          <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-6 space-y-4 shadow-sm">
            <h2 className="text-sm font-bold text-bhodix-text tracking-tight">
              Bhodhix Corporate Shared Infrastructure & SaaS Overheads
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-bhodix-border text-bhodix-textSubtle font-mono text-[11px] uppercase">
                    <th className="pb-3">Service</th>
                    <th className="pb-3">Provider</th>
                    <th className="pb-3">Cost (INR)</th>
                    <th className="pb-3">Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bhodix-borderSubtle">
                  {!tables.overheads?.length && (
                    <tr><td colSpan={4} className="py-6 text-center text-bhodix-textSubtle font-mono">No shared overheads recorded yet.</td></tr>
                  )}
                  {tables.overheads?.map((ov, idx) => (
                    <tr key={idx} className="hover:bg-bhodix-surface/40">
                      <td className="py-3 font-semibold text-bhodix-text">{ov.service}</td>
                      <td className="py-3 text-bhodix-textMuted">{ov.provider}</td>
                      <td className="py-3 font-mono text-rose-500 font-medium">{formatINR(ov.cost__inr_)}</td>
                      <td className="py-3 text-bhodix-textSubtle">{ov.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* INDIVIDUAL APP VIEW */}
      {activeProject && (() => {
        const currentData = vault?.projects?.[activeProject.id]?.finances || {};
        const appMeta = currentData.meta || {};
        const appTables = currentData.tables || {};

        return (
          <div className="space-y-6">
            {/* App Unit Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-5 space-y-2 shadow-sm">
                <span className="text-[11px] font-mono text-bhodix-textSubtle uppercase">Gross Monthly Inflow</span>
                <div className="text-2xl font-bold font-mono text-bhodix-text">
                  {formatINR(appMeta.monthly_gross_revenue)}
                </div>
                <div className="text-[11px] text-indigo-500 dark:text-indigo-400 font-mono">Active Client Retainers</div>
              </div>

              <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-5 space-y-2 shadow-sm">
                <span className="text-[11px] font-mono text-bhodix-textSubtle uppercase">Direct Cloud Burn</span>
                <div className="text-2xl font-bold font-mono text-bhodix-text">
                  {formatINR(appMeta.monthly_total_expenses)}
                </div>
                <div className="text-[11px] text-rose-500 font-mono">Dedicated Hosting & APIs</div>
              </div>

              <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-5 space-y-2 shadow-sm">
                <span className="text-[11px] font-mono text-bhodix-textSubtle uppercase">Net Monthly Contribution</span>
                <div className="text-2xl font-bold font-mono text-bhodix-text">
                  {formatINR(appMeta.net_monthly_margin)}
                </div>
                <div className="text-[11px] text-emerald-500 dark:text-emerald-400 font-mono">To Bhodhix Treasury</div>
              </div>

              <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-5 space-y-2 shadow-sm">
                <span className="text-[11px] font-mono text-bhodix-textSubtle uppercase">Operating Margin</span>
                <div className="text-2xl font-bold font-mono text-bhodix-text">
                  {appMeta.monthly_gross_revenue > 0 ? `${appMeta.net_margin_percentage}%` : '—'}
                </div>
                <div className="text-[11px] text-emerald-500 dark:text-emerald-400 font-mono">{appMeta.net_monthly_margin > 0 ? 'Unit Profitable' : ''}</div>
              </div>
            </div>

            {/* Inflow Ledger */}
            <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-6 space-y-4 shadow-sm">
              <h2 className="text-sm font-bold text-bhodix-text tracking-tight">
                Client Revenue Streams & Billing Ledger
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-bhodix-border text-bhodix-textSubtle font-mono text-[11px] uppercase">
                      <th className="pb-3">Client / Entity</th>
                      <th className="pb-3">Fee Type</th>
                      <th className="pb-3">Amount</th>
                      <th className="pb-3">Cycle</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3">Next Invoice</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bhodix-borderSubtle">
                    {!appTables.revenueStreams?.length && (
                      <tr><td colSpan={6} className="py-6 text-center text-bhodix-textSubtle font-mono">No revenue streams recorded yet.</td></tr>
                    )}
                    {appTables.revenueStreams?.map((rev, idx) => (
                      <tr key={idx} className="hover:bg-bhodix-surface/40">
                        <td className="py-3 font-semibold text-bhodix-text">
                          {rev.client___partner || rev.client_nbfc || rev.client___source}
                        </td>
                        <td className="py-3 text-bhodix-textMuted">{rev.type}</td>
                        <td className="py-3 font-mono text-emerald-500 dark:text-emerald-400 font-bold">
                          {formatINR(rev.amount__inr_ ?? rev.amount)}
                        </td>
                        <td className="py-3 font-mono text-bhodix-textSubtle">{rev.billing_cycle || rev.frequency}</td>
                        <td className="py-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20">
                            {rev.status}
                          </span>
                        </td>
                        <td className="py-3 font-mono text-amber-500 dark:text-amber-300">{rev.next_invoice || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Expense Ledger */}
            <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-6 space-y-4 shadow-sm">
              <h2 className="text-sm font-bold text-bhodix-text tracking-tight">
                Dedicated Infrastructure & API Burn Breakdown
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-bhodix-border text-bhodix-textSubtle font-mono text-[11px] uppercase">
                      <th className="pb-3">Item / Service</th>
                      <th className="pb-3">Provider</th>
                      <th className="pb-3">Cost</th>
                      <th className="pb-3">Purpose</th>
                      <th className="pb-3">Billing Mode</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bhodix-borderSubtle">
                    {!appTables.expenses?.length && (
                      <tr><td colSpan={5} className="py-6 text-center text-bhodix-textSubtle font-mono">No expenses recorded yet.</td></tr>
                    )}
                    {appTables.expenses?.map((exp, idx) => (
                      <tr key={idx} className="hover:bg-bhodix-surface/40">
                        <td className="py-3 font-semibold text-bhodix-text">{exp.item___service || exp.service}</td>
                        <td className="py-3 text-bhodix-textMuted">{exp.provider || exp.category}</td>
                        <td className="py-3 font-mono text-rose-500 font-bold">
                          {formatINR(exp.cost__inr_ ?? exp.cost)}
                        </td>
                        <td className="py-3 text-bhodix-textSubtle">{exp.purpose || exp.notes}</td>
                        <td className="py-3 font-mono text-[11px] text-bhodix-textSubtle">
                          {exp.auto_debit || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
