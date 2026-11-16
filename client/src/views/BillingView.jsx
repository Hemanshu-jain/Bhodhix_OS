import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FilePlus2, FileText, ImagePlus, Plus, Printer, Receipt, Save, Trash2 } from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { useToast } from '../components/ToastProvider';
import BillingDocument from './BillingDocument';

const QUOTATION_TERMS = [
  'Payment. Milestone payments are due as listed above. Work on a milestone begins on receipt of its payment.',
  'Third-party charges. Third-party onboarding charges include GST levied by the provider and are borne by the Client.',
  'Taxes. All prices are in Indian Rupees (₹). GST is not charged on the Company’s own fees while the Company is not registered under GST.',
  'Scope. This quotation covers only the application and services described above. Additional features or integrations will be quoted separately.',
  'Validity. This quotation is valid for 15 days from the date of issue.'
];
const INVOICE_NOTES = [
  'Please quote the invoice number in the payment reference.',
  'GST is not charged on the Company’s own fees while the Company is not registered under GST.',
  'Third-party onboarding charges, where billed, are inclusive of GST levied by the provider.'
];
const LOS_LMS_BRIEF = 'A web-based loan origination and management system for vehicle loans, covering the full loan lifecycle from customer onboarding to disbursement.';
const initialItem = () => ({ description: 'Software development – Milestone 1', details: 'Payable upfront, on acceptance of this quotation', amount: '' });
const paymentPlan = (mode, count = 3) => {
  if (mode === 'single') return [{ label: 'Full payment', details: 'Payable on acceptance of this quotation', mode: 'percent', value: '100' }];
  if (mode === 'two-part') return [
    { label: 'Milestone 1', details: 'Payable upfront, on acceptance of this quotation', mode: 'percent', value: '50' },
    { label: 'Milestone 2', details: 'Payable on delivery (go-live)', mode: 'percent', value: '50' }
  ];
  if (mode === 'three-part') return [
    { label: 'Milestone 1', details: 'Payable on acceptance of this quotation', mode: 'percent', value: '30' },
    { label: 'Milestone 2', details: 'Payable on completion of development', mode: 'percent', value: '40' },
    { label: 'Milestone 3', details: 'Payable on delivery (go-live)', mode: 'percent', value: '30' }
  ];
  if (mode === 'monthly') {
    const months = Math.min(48, Math.max(1, Number(count) || 3));
    const each = Number((100 / months).toFixed(2));
    return Array.from({ length: months }, (_, index) => ({ label: `Month ${index + 1}`, details: 'Monthly installment', mode: 'percent', value: String(index === months - 1 ? Number((100 - each * (months - 1)).toFixed(2)) : each) }));
  }
  return [{ label: '', details: '', mode: 'percent', value: '' }];
};
const blankData = (name, legalName) => ({
  company: { name: name || '', legalName: legalName || '', documentPrefix: 'BSLLP', address: '', phonePrimary: '', phoneSecondary: '', email: '', gstin: '', llpin: '', pan: '', signatoryName: '', bankName: '', bankBranch: '', accountNumber: '', ifsc: '', upiId: '', logoDataUrl: '', quotationTerms: QUOTATION_TERMS, invoiceNotes: INVOICE_NOTES },
  clients: [], quotations: [], invoices: [], projectTemplates: []
});
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const makeId = () => crypto.randomUUID().replaceAll('-', '');
const financialYear = () => {
  const date = new Date(); const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
};
const nextNumber = (documents, kind, prefix = 'BSLLP') => {
  const fy = financialYear(); const code = kind === 'quotation' ? 'Q' : 'INV';
  const pattern = new RegExp(`^${prefix}/${fy}/${code}-(\\d+)$`);
  const latest = documents.reduce((value, item) => Math.max(value, Number(item.number?.match(pattern)?.[1] || 0)), 0);
  return `${prefix}/${fy}/${code}-${String(latest + 1).padStart(3, '0')}`;
};
const totalOf = (items = []) => items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
const inr = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0));
const inputClass = 'w-full rounded-lg border border-bhodix-border bg-bhodix-bg px-3 py-2 text-sm text-bhodix-text placeholder:text-bhodix-textSubtle focus:border-indigo-500 focus:outline-none';
const statuses = { quotation: ['draft', 'sent', 'accepted', 'declined'], invoice: ['draft', 'sent', 'paid', 'overdue'] };

export default function BillingView() {
  const { apiFetch, user, companyName, legalName, projectList, vault } = useVault();
  const { showToast } = useToast();
  const [data, setData] = useState(() => blankData(companyName, legalName));
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(0);
  const savingRef = useRef(false);
  const templateTimerRef = useRef(null);
  const templateSavingRef = useRef(null);
  const pendingTemplateRef = useRef(null);
  const templateSequenceRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templateSaveState, setTemplateSaveState] = useState('');
  const [tab, setTab] = useState('overview');
  const [clientDraft, setClientDraft] = useState({ name: '', email: '', phone: '', address: '', gstin: '' });
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [editingQuoteId, setEditingQuoteId] = useState('');
  const [activeDocument, setActiveDocument] = useState(null);
  const blankQuote = () => ({ clientId: '', projectId: '', title: '', subtitle: '', brief: '', issueDate: today(), validityDays: '15', terms: [...QUOTATION_TERMS], billingMode: 'two-part', monthlyCount: '3', paymentSchedule: paymentPlan('two-part'), items: [initialItem()] });
  const [quoteDraft, setQuoteDraft] = useState(blankQuote);

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/api/billing');
      const saved = await response.json();
      if (!response.ok || !saved.success) throw new Error(saved.error || 'Could not load billing workspace');
      const loaded = saved.data || blankData(companyName, legalName);
      loaded.company = { ...blankData(companyName, legalName).company, ...(loaded.company || {}) };
      loaded.clients ||= []; loaded.quotations ||= []; loaded.invoices ||= []; loaded.projectTemplates ||= [];
      setData(loaded);
      revisionRef.current = saved.revision || 0;
      setRevision(revisionRef.current);
    } catch (error) {
      showToast(error.message || 'Could not load billing workspace', 'error');
    } finally { setLoading(false); }
  };

  useEffect(() => { if (['owner', 'admin'].includes(user?.role)) void load(); else setLoading(false); }, []);

  const save = async (next) => {
    if (savingRef.current) return false;
    savingRef.current = true; setSaving(true);
    try {
      const response = await apiFetch('/api/billing', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: revisionRef.current, billing: next })
      });
      const result = await response.json();
      if (response.status === 409) { await load(); throw new Error('Another session updated billing. The latest records were reloaded; please apply your change again.'); }
      if (!response.ok || !result.success) throw new Error(result.error || 'Could not save billing changes');
      revisionRef.current = result.revision; setRevision(result.revision); setData(result.data); return true;
    } catch (error) { showToast(error.message || 'Could not save billing changes', 'error'); return false; }
    finally { savingRef.current = false; setSaving(false); }
  };

  const projectTemplate = (draft) => ({
    projectId: draft.projectId, subtitle: draft.subtitle, brief: draft.brief, billingMode: draft.billingMode, monthlyCount: draft.monthlyCount,
    items: draft.items.map(({ description, details }) => ({ description, details })),
    schedule: draft.paymentSchedule.map(({ label, details, mode }) => ({ label, details, mode }))
  });
  const enqueueProjectTemplate = (template) => {
    pendingTemplateRef.current = { template, sequence: ++templateSequenceRef.current };
    if (templateSavingRef.current) return templateSavingRef.current;
    const task = (async () => {
      while (pendingTemplateRef.current) {
        const pending = pendingTemplateRef.current;
        pendingTemplateRef.current = null;
        try {
          const response = await apiFetch(`/api/billing/project-templates/${encodeURIComponent(pending.template.projectId)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.template)
          });
          const result = await response.json();
          if (!response.ok || !result.success) throw new Error(result.error || 'Could not save project quotation defaults');
          revisionRef.current = result.revision; setRevision(result.revision);
          setData((current) => ({ ...current, projectTemplates: result.projectTemplates }));
          if (pending.sequence === templateSequenceRef.current) setTemplateSaveState('saved');
        } catch (error) {
          pendingTemplateRef.current = null;
          setTemplateSaveState('error');
          showToast(error.message || 'Could not autosave this project’s quotation wording', 'error');
          return false;
        }
      }
      return true;
    })();
    templateSavingRef.current = task;
    return task.finally(() => {
      templateSavingRef.current = null;
      if (pendingTemplateRef.current) void enqueueProjectTemplate(pendingTemplateRef.current.template);
    });
  };
  const flushProjectTemplate = async (draft) => {
    if (templateTimerRef.current) { clearTimeout(templateTimerRef.current); templateTimerRef.current = null; }
    if (!draft.projectId) return true;
    if (templateSavingRef.current) await templateSavingRef.current;
    return enqueueProjectTemplate(projectTemplate(draft));
  };
  const projectBrief = (project) => {
    if (/los\s*lms/i.test(project?.name || '')) return LOS_LMS_BRIEF;
    return String(vault?.projects?.[project?.id]?.meta?.description || '');
  };
  const selectProject = (projectId) => {
    if (quoteDraft.projectId) void flushProjectTemplate(quoteDraft);
    const project = projectList.find((item) => item.id === projectId);
    const stored = data.projectTemplates.find((item) => item.projectId === projectId);
    const billingMode = stored?.billingMode || 'two-part';
    const count = stored?.monthlyCount || 3;
    const standardSchedule = paymentPlan(billingMode, count);
    const paymentSchedule = stored?.schedule?.length ? stored.schedule.map((item, index) => ({ ...item, value: standardSchedule[index]?.value ?? '' })) : standardSchedule;
    setQuoteDraft((current) => ({
      ...blankQuote(), clientId: current.clientId, projectId, title: project?.name || '',
      subtitle: stored?.subtitle || (/los\s*lms/i.test(project?.name || '') ? 'Loan Origination & Management System' : String(vault?.projects?.[projectId]?.meta?.subtitle || '')),
      brief: stored?.brief || projectBrief(project), billingMode, monthlyCount: String(count), paymentSchedule,
      items: stored?.items?.length ? stored.items.map((item) => ({ ...item, amount: '' })) : [initialItem()]
    }));
    setTemplateSaveState(stored ? 'saved' : '');
  };

  const updateCompany = (key, value) => setData((current) => ({ ...current, company: { ...current.company, [key]: value } }));
  const saveCompany = async (event) => { event.preventDefault(); if (await save(data)) showToast('Company billing details saved', 'success'); };
  const uploadLogo = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1_000_000) return showToast('Choose a PNG, JPEG, or WebP logo under 1 MB', 'error');
    const reader = new FileReader();
    reader.onload = () => updateCompany('logoDataUrl', String(reader.result || ''));
    reader.onerror = () => showToast('Could not read this logo file', 'error');
    reader.readAsDataURL(file);
  };

  const saveClient = async (event) => {
    event.preventDefault();
    if (!clientDraft.name.trim()) return showToast('Enter a client or company name', 'error');
    const next = { ...data, clients: [...data.clients, { ...clientDraft, id: makeId() }] };
    if (await save(next)) { setClientDraft({ name: '', email: '', phone: '', address: '', gstin: '' }); showToast('Client saved', 'success'); }
  };
  const removeClient = async (id) => {
    if (data.quotations.some((item) => item.clientId === id) || data.invoices.some((item) => item.clientId === id)) return showToast('This client is linked to a quotation or invoice and cannot be removed', 'error');
    if (await save({ ...data, clients: data.clients.filter((client) => client.id !== id) })) showToast('Client removed', 'success');
  };

  const setItem = (index, key, value) => setQuoteDraft((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }));
  const openNewQuote = () => { setEditingQuoteId(''); setQuoteDraft({ ...blankQuote(), terms: [...(data.company.quotationTerms || QUOTATION_TERMS)] }); setTemplateSaveState(''); setQuoteOpen(true); };
  const editQuote = (quote) => {
    if (quote.status !== 'draft') return showToast('Only draft quotations can be edited', 'error');
    const linkedProject = projectList.find((project) => project.id === quote.projectId || (!quote.projectId && project.name === quote.title));
    const billingMode = quote.billingMode || 'custom';
    setEditingQuoteId(quote.id);
    setQuoteDraft({ ...blankQuote(), clientId: quote.clientId, projectId: quote.projectId || linkedProject?.id || '', title: quote.title, subtitle: quote.subtitle || '', brief: quote.brief || '', issueDate: quote.issueDate || today(), validityDays: String(quote.validityDays || 15), terms: [...(quote.terms || QUOTATION_TERMS)], billingMode, monthlyCount: String(quote.monthlyCount || 3), paymentSchedule: quote.paymentSchedule?.length ? quote.paymentSchedule.map((item) => ({ ...item, value: String(item.value) })) : paymentPlan(billingMode), items: quote.items.map((item) => ({ description: item.description, details: item.details || '', amount: String(item.amount) })) });
    setTemplateSaveState('');
    setQuoteOpen(true);
  };
  const createQuote = async (event) => {
    event.preventDefault();
    if (!quoteDraft.clientId || !quoteDraft.projectId || !quoteDraft.title.trim() || !quoteDraft.items.every((item) => item.description.trim() && Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0) || !quoteDraft.paymentSchedule.every((item) => item.label.trim() && Number.isFinite(Number(item.value)) && Number(item.value) >= 0)) return showToast('Complete the client, project, descriptions, amounts, and payment schedule', 'error');
    if (totalOf(quoteDraft.items) > 0 && quoteDraft.paymentSchedule.reduce((sum, item) => sum + (item.mode === 'percent' ? totalOf(quoteDraft.items) * Number(item.value) / 100 : Number(item.value)), 0) > totalOf(quoteDraft.items) + 1) return showToast('The payment schedule cannot exceed the quotation total', 'error');
    await flushProjectTemplate(quoteDraft);
    const existing = data.quotations.find((item) => item.id === editingQuoteId);
    const document = {
      id: existing?.id || makeId(), number: existing?.number || nextNumber(data.quotations, 'quotation', data.company.documentPrefix), clientId: quoteDraft.clientId, projectId: quoteDraft.projectId,
      title: quoteDraft.title.trim(), subtitle: quoteDraft.subtitle.trim(), brief: quoteDraft.brief.trim(), issueDate: quoteDraft.issueDate, validityDays: Number(quoteDraft.validityDays) || 15,
      billingMode: quoteDraft.billingMode, monthlyCount: Number(quoteDraft.monthlyCount) || 3, paymentSchedule: quoteDraft.paymentSchedule.map((item) => ({ ...item, value: Number(item.value) })),
      status: existing?.status || 'draft', terms: quoteDraft.terms.map((item) => item.trim()).filter(Boolean),
      items: quoteDraft.items.map((item) => ({ description: item.description.trim(), details: item.details.trim(), amount: Math.round(Number(item.amount)) }))
    };
    const quotations = existing ? data.quotations.map((item) => item.id === existing.id ? document : item) : [document, ...data.quotations];
    const template = projectTemplate(quoteDraft);
    const projectTemplates = [...data.projectTemplates.filter((item) => item.projectId !== template.projectId), template];
    if (await save({ ...data, quotations, projectTemplates })) {
      setQuoteOpen(false); setEditingQuoteId(''); setQuoteDraft(blankQuote());
      setTab('quotations'); setActiveDocument({ type: 'quotation', id: document.id }); showToast(existing ? 'Quotation updated' : 'Quotation draft saved', 'success');
    }
  };

  const updateDocumentStatus = async (kind, id, status) => {
    const key = kind === 'quotation' ? 'quotations' : 'invoices';
    if (await save({ ...data, [key]: data[key].map((item) => item.id === id ? { ...item, status } : item) })) showToast(`${kind === 'quotation' ? 'Quotation' : 'Invoice'} updated`, 'success');
  };
  const convertToInvoice = async (quote) => {
    if (data.invoices.some((invoice) => invoice.sourceQuotationId === quote.id)) return showToast('An invoice already exists for this quotation', 'info');
    const invoice = { ...quote, id: makeId(), number: nextNumber(data.invoices, 'invoice', data.company.documentPrefix), issueDate: today(), dueDate: '', quotationRef: quote.number, notesList: [...(data.company.invoiceNotes || INVOICE_NOTES)], status: 'draft', sourceQuotationId: quote.id };
    if (await save({ ...data, invoices: [invoice, ...data.invoices] })) { setTab('invoices'); setActiveDocument({ type: 'invoice', id: invoice.id }); showToast('Invoice draft created from quotation', 'success'); }
  };

  const updateInvoiceDueDate = async (invoiceId, dueDate) => {
    const invoices = data.invoices.map((invoice) => invoice.id === invoiceId ? { ...invoice, dueDate } : invoice);
    await save({ ...data, invoices });
  };

  useEffect(() => {
    if (!quoteOpen || !quoteDraft.projectId) return undefined;
    setTemplateSaveState('saving');
    templateTimerRef.current = setTimeout(() => { templateTimerRef.current = null; void enqueueProjectTemplate(projectTemplate(quoteDraft)); }, 750);
    return () => { if (templateTimerRef.current) clearTimeout(templateTimerRef.current); };
  }, [quoteOpen, quoteDraft.projectId, quoteDraft.subtitle, quoteDraft.brief, quoteDraft.billingMode, quoteDraft.monthlyCount, quoteDraft.paymentSchedule, quoteDraft.items]);

  const clientName = (id) => data.clients.find((client) => client.id === id)?.name || 'Client removed';
  const scheduleAmount = (item) => item.mode === 'percent' ? totalOf(quoteDraft.items) * Number(item.value || 0) / 100 : Number(item.value || 0);
  const scheduledTotal = quoteDraft.paymentSchedule.reduce((sum, item) => sum + scheduleAmount(item), 0);
  const scheduledPercent = quoteDraft.paymentSchedule.reduce((sum, item) => sum + (item.mode === 'percent' ? Number(item.value || 0) : totalOf(quoteDraft.items) ? scheduleAmount(item) * 100 / totalOf(quoteDraft.items) : 0), 0);
  const changeBillingMode = (billingMode) => setQuoteDraft((current) => ({ ...current, billingMode, paymentSchedule: paymentPlan(billingMode, current.monthlyCount) }));
  const setScheduleItem = (index, key, value) => setQuoteDraft((current) => ({ ...current, paymentSchedule: current.paymentSchedule.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }));
  const amounts = useMemo(() => ({ quotations: data.quotations.reduce((sum, item) => sum + totalOf(item.items), 0), invoicesDue: data.invoices.filter((item) => !['paid', 'declined'].includes(item.status)).reduce((sum, item) => sum + totalOf(item.items), 0) }), [data]);
  const isManager = ['owner', 'admin'].includes(user?.role);

  if (!isManager) return <div className="mx-auto max-w-3xl p-8 text-sm text-bhodix-textMuted">Billing is available to workspace owners and admins.</div>;
  if (loading) return <div className="p-8 text-sm text-bhodix-textMuted">Loading billing workspace…</div>;

  const tabs = [['overview', 'Overview'], ['quotations', 'Quotations'], ['invoices', 'Invoices'], ['clients', 'Clients'], ['company', 'Company profile']];
  const input = (label, key, type = 'text', placeholder = '') => <label className="block space-y-1.5 text-xs text-bhodix-textMuted"><span>{label}</span><input type={type} value={data.company[key] || ''} onChange={(event) => updateCompany(key, event.target.value)} placeholder={placeholder} className={inputClass} /></label>;

  const currentRecord = activeDocument?.type === 'quotation' ? data.quotations.find((item) => item.id === activeDocument.id) : activeDocument?.type === 'invoice' ? data.invoices.find((item) => item.id === activeDocument.id) : null;
  if (activeDocument && currentRecord) {
    const isQuote = activeDocument.type === 'quotation';
    const currentClient = data.clients.find((client) => client.id === currentRecord.clientId) || { name: 'Client removed', address: '', gstin: '' };
    return <div className="mx-auto max-w-[1600px] w-full space-y-4 p-4 md:p-8">
      <div className="billing-screen-controls flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bhodix-border bg-bhodix-card p-3">
        <div className="flex flex-wrap items-center gap-3"><button onClick={() => setActiveDocument(null)} className="inline-flex items-center gap-2 rounded-lg border border-bhodix-border px-3 py-2 text-xs text-bhodix-textMuted"><ArrowLeft className="h-4 w-4" />Back</button><span className="font-mono text-xs text-indigo-400">{currentRecord.number}</span><select aria-label="Document status" value={currentRecord.status} onChange={(event) => void updateDocumentStatus(activeDocument.type, currentRecord.id, event.target.value)} className="rounded-lg border border-bhodix-border bg-bhodix-bg px-2 py-2 text-xs text-bhodix-text">{statuses[activeDocument.type].map((status) => <option key={status} value={status}>{status}</option>)}</select>{!isQuote && <label className="flex items-center gap-2 text-xs text-bhodix-textMuted">Due date<input type="date" value={currentRecord.dueDate || ''} onChange={(event) => void updateInvoiceDueDate(currentRecord.id, event.target.value)} className="rounded-lg border border-bhodix-border bg-bhodix-bg px-2 py-1.5 text-xs text-bhodix-text" /></label>}{isQuote && currentRecord.status === 'draft' && <button onClick={() => editQuote(currentRecord)} className="rounded-lg border border-bhodix-border px-3 py-2 text-xs text-bhodix-textMuted">Edit draft</button>}{isQuote && currentRecord.status === 'accepted' && !data.invoices.some((invoice) => invoice.sourceQuotationId === currentRecord.id) && <button onClick={() => void convertToInvoice(currentRecord)} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">Create invoice</button>}</div>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white"><Printer className="h-4 w-4" />Print / Save PDF</button>
      </div>
      <BillingDocument type={activeDocument.type} document={currentRecord} client={currentClient} company={data.company} onBack={() => setActiveDocument(null)} onPrint={() => window.print()} />
    </div>;
  }

  return <div className="mx-auto max-w-[1600px] w-full space-y-5 p-4 md:p-8">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><div className="flex items-center gap-2 text-indigo-400"><Receipt className="h-5 w-5" /><span className="font-mono text-[10px] uppercase tracking-[.2em]">Client billing</span></div><h1 className="mt-2 text-2xl font-bold text-bhodix-text">Quotations & invoices</h1><p className="mt-1 max-w-2xl text-sm text-bhodix-textMuted">Prepare client quotations in your company format, then convert accepted work into invoices.</p></div><div className="flex gap-2"><button onClick={() => setTab('company')} className="rounded-lg border border-bhodix-border px-3 py-2 text-xs text-bhodix-textMuted hover:bg-bhodix-hover">Company details</button><button onClick={openNewQuote} disabled={!data.clients.length || !projectList.length} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"><FilePlus2 className="h-4 w-4" />New quotation</button></div></header>

    <nav aria-label="Billing sections" className="flex gap-1 overflow-x-auto border-b border-bhodix-border">{tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined} className={`shrink-0 border-b-2 px-3 py-2.5 text-xs font-medium ${tab === id ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-bhodix-textSubtle hover:text-bhodix-text'}`}>{label}</button>)}</nav>

    {tab === 'overview' && <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ['Quotations', data.quotations.length, 'saved records'], ['Invoices', data.invoices.length, 'saved records'], ['Quotation value', inr(amounts.quotations), 'all quotation statuses'], ['Open invoices', inr(amounts.invoicesDue), 'excluding paid invoices']
      ].map(([label, value, helper]) => <article key={label} className="rounded-xl border border-bhodix-border bg-bhodix-card p-4"><p className="text-[10px] font-mono uppercase tracking-wider text-bhodix-textSubtle">{label}</p><p className="mt-2 text-xl font-semibold text-bhodix-text">{value}</p><p className="mt-1 text-[10px] text-bhodix-textSubtle">{helper}</p></article>)}</section>
      <section className="grid gap-4 xl:grid-cols-2"><div className="rounded-xl border border-bhodix-border bg-bhodix-card p-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-bhodix-text">Recent quotations</h2><button onClick={() => setTab('quotations')} className="text-xs text-indigo-400">View all</button></div>{!data.quotations.length ? <p className="py-8 text-center text-xs text-bhodix-textSubtle">Create your first quotation after adding a client.</p> : <div className="divide-y divide-bhodix-borderSubtle">{data.quotations.slice(0, 5).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3"><div><p className="text-xs font-medium text-bhodix-text">{item.number} · {item.title}</p><p className="mt-1 text-[10px] text-bhodix-textSubtle">{clientName(item.clientId)} · {item.status}</p></div><p className="text-xs font-semibold text-bhodix-text">{inr(totalOf(item.items))}</p></div>)}</div>}</div><div className="rounded-xl border border-bhodix-border bg-bhodix-card p-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-bhodix-text">Recent invoices</h2><button onClick={() => setTab('invoices')} className="text-xs text-indigo-400">View all</button></div>{!data.invoices.length ? <p className="py-8 text-center text-xs text-bhodix-textSubtle">Accepted quotations can be converted into invoices.</p> : <div className="divide-y divide-bhodix-borderSubtle">{data.invoices.slice(0, 5).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3"><div><p className="text-xs font-medium text-bhodix-text">{item.number} · {item.title}</p><p className="mt-1 text-[10px] text-bhodix-textSubtle">{clientName(item.clientId)} · {item.status}</p></div><p className="text-xs font-semibold text-bhodix-text">{inr(totalOf(item.items))}</p></div>)}</div>}</div></section>
    </>}

    {tab === 'company' && <form onSubmit={saveCompany} className="w-full space-y-5 rounded-2xl border border-bhodix-border bg-bhodix-card p-4 md:p-6 shadow-sm">
      <div><h2 className="text-sm font-semibold text-bhodix-text">Company billing details</h2><p className="mt-1 text-xs text-bhodix-textSubtle">These details identify your company on client documents.</p></div>
      <div className="grid gap-4 sm:grid-cols-2">{input('Display name', 'name', 'text', companyName || 'Company name')}{input('Legal name', 'legalName', 'text', legalName || 'Registered legal name')}{input('Document number prefix', 'documentPrefix', 'text', 'BSLLP')}{input('GSTIN', 'gstin', 'text', 'GST registration number')}{input('Primary phone', 'phonePrimary', 'tel', '+91')}{input('Secondary phone', 'phoneSecondary', 'tel', '+91')}{input('Billing email', 'email', 'email', 'accounts@example.com')}{input('LLPIN', 'llpin', 'text', 'LLPIN')}{input('PAN', 'pan', 'text', 'PAN')}{input('Authorised signatory', 'signatoryName', 'text', 'Name of signatory')}
        <label className="row-span-2 flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-bhodix-border bg-bhodix-bg p-4 text-center text-xs text-bhodix-textMuted"><input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo} />{data.company.logoDataUrl ? <img src={data.company.logoDataUrl} alt="Company logo preview" className="max-h-20 max-w-48 object-contain" /> : <ImagePlus className="h-6 w-6 text-bhodix-textSubtle" />}<span>{data.company.logoDataUrl ? 'Change company logo' : 'Import company logo'}</span><span className="text-[10px] text-bhodix-textSubtle">PNG, JPEG, or WebP · under 1 MB</span></label>
      </div>
      <label className="block space-y-1.5 text-xs text-bhodix-textMuted"><span>Registered / billing address</span><textarea rows={3} value={data.company.address || ''} onChange={(event) => updateCompany('address', event.target.value)} placeholder="Street, city, state, postal code" className={inputClass} /></label>
      <div className="grid gap-4 sm:grid-cols-2">{input('Bank name', 'bankName', 'text', 'Bank')}{input('Bank branch', 'bankBranch', 'text', 'Branch')}{input('Account number', 'accountNumber', 'text', 'Account number')}{input('IFSC', 'ifsc', 'text', 'IFSC')}{input('UPI ID', 'upiId', 'text', 'name@bank')}</div>
      <label className="block space-y-1.5 text-xs text-bhodix-textMuted"><span>Quotation terms (one per line)</span><textarea rows={6} value={(data.company.quotationTerms || []).join('\n')} onChange={(event) => updateCompany('quotationTerms', event.target.value.split('\n'))} className={inputClass} /></label>
      <label className="block space-y-1.5 text-xs text-bhodix-textMuted"><span>Invoice notes (one per line)</span><textarea rows={4} value={(data.company.invoiceNotes || []).join('\n')} onChange={(event) => updateCompany('invoiceNotes', event.target.value.split('\n'))} className={inputClass} /></label>
      <div className="flex justify-end"><button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save company details'}</button></div>
    </form>}

    {tab === 'clients' && <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_1fr]">
      <form onSubmit={saveClient} className="h-fit space-y-3 rounded-xl border border-bhodix-border bg-bhodix-card p-4"><h2 className="text-sm font-semibold text-bhodix-text">Add a client</h2><input required value={clientDraft.name} onChange={(e) => setClientDraft({ ...clientDraft, name: e.target.value })} placeholder="Client or company name" className={inputClass} /><input type="email" value={clientDraft.email} onChange={(e) => setClientDraft({ ...clientDraft, email: e.target.value })} placeholder="Billing email" className={inputClass} /><input value={clientDraft.phone} onChange={(e) => setClientDraft({ ...clientDraft, phone: e.target.value })} placeholder="Phone" className={inputClass} /><input value={clientDraft.gstin} onChange={(e) => setClientDraft({ ...clientDraft, gstin: e.target.value })} placeholder="GSTIN (if applicable)" className={inputClass} /><textarea rows={3} value={clientDraft.address} onChange={(e) => setClientDraft({ ...clientDraft, address: e.target.value })} placeholder="Billing address" className={inputClass} /><button disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" />Save client</button></form>
      <section className="rounded-xl border border-bhodix-border bg-bhodix-card p-4"><h2 className="mb-3 text-sm font-semibold text-bhodix-text">Clients <span className="ml-1 text-xs font-normal text-bhodix-textSubtle">{data.clients.length}</span></h2>{!data.clients.length ? <p className="py-10 text-center text-xs text-bhodix-textSubtle">Saved clients will appear here.</p> : <div className="space-y-2">{data.clients.map((client) => <article key={client.id} className="flex items-start justify-between gap-3 rounded-lg border border-bhodix-borderSubtle p-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-bhodix-text">{client.name}</p><p className="mt-1 break-words text-xs text-bhodix-textSubtle">{[client.email, client.phone, client.gstin].filter(Boolean).join(' · ') || 'No contact details'}{client.address && <span className="mt-1 block">{client.address}</span>}</p></div><button aria-label={`Remove ${client.name}`} onClick={() => void removeClient(client.id)} className="rounded p-2 text-bhodix-textSubtle hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button></article>)}</div>}</section>
    </div>}

    {(tab === 'quotations' || tab === 'invoices') && <section className="rounded-xl border border-bhodix-border bg-bhodix-card p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold text-bhodix-text">{tab === 'quotations' ? 'Quotations' : 'Invoices'}</h2><p className="mt-1 text-xs text-bhodix-textSubtle">{tab === 'quotations' ? 'Track draft, sent, accepted, and declined quotations.' : 'Track invoice drafts and payment status.'}</p></div>{tab === 'quotations' && <button onClick={openNewQuote} disabled={!data.clients.length || !projectList.length} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" />New quotation</button>}</div>
      {!(tab === 'quotations' ? data.quotations : data.invoices).length ? <p className="py-12 text-center text-xs text-bhodix-textSubtle">{tab === 'quotations' ? (data.clients.length ? 'No quotations yet. Start one with “New quotation”.' : 'Add a client before creating a quotation.') : 'Invoices created from accepted quotations will appear here.'}</p> : <div className="space-y-2">{(tab === 'quotations' ? data.quotations : data.invoices).map((item) => {
        const isQuote = tab === 'quotations';
        const client = data.clients.find((entry) => entry.id === item.clientId);
        return <article key={item.id} className="grid gap-3 rounded-lg border border-bhodix-borderSubtle p-3 md:grid-cols-[1fr_auto_auto] md:items-center"><button onClick={() => setActiveDocument({ type: isQuote ? 'quotation' : 'invoice', id: item.id })} className="min-w-0 text-left"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] text-indigo-400">{item.number}</span><span className={`rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wide ${item.status === 'paid' || item.status === 'accepted' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-bhodix-hover text-bhodix-textMuted'}`}>{item.status}</span></div><p className="mt-1 truncate text-sm font-medium text-bhodix-text">{item.title}</p><p className="mt-1 text-xs text-bhodix-textSubtle">{client?.name || 'Client removed'} · {item.issueDate || 'No date'}</p></button><div className="font-semibold text-bhodix-text">{inr(totalOf(item.items))}</div><div className="flex flex-wrap items-center gap-2"><select aria-label={`${item.number} status`} value={item.status} onChange={(event) => void updateDocumentStatus(isQuote ? 'quotation' : 'invoice', item.id, event.target.value)} className="rounded-lg border border-bhodix-border bg-bhodix-bg px-2 py-1.5 text-[10px] text-bhodix-text">{statuses[isQuote ? 'quotation' : 'invoice'].map((status) => <option key={status} value={status}>{status}</option>)}</select>{isQuote && item.status === 'accepted' && !data.invoices.some((invoice) => invoice.sourceQuotationId === item.id) && <button onClick={() => void convertToInvoice(item)} className="rounded-lg border border-indigo-500/30 px-2.5 py-1.5 text-[10px] font-medium text-indigo-400 hover:bg-indigo-500/10">Create invoice</button>}</div></article>;
      })}</div>}
    </section>}

    {quoteOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 md:items-center md:p-5"><form onSubmit={createQuote} className="max-h-[92dvh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-t-2xl border border-bhodix-border bg-bhodix-surface p-4 shadow-2xl md:rounded-2xl md:p-6">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-bhodix-text">{editingQuoteId ? 'Edit quotation draft' : 'New quotation'}</h2><p className="mt-1 text-xs text-bhodix-textSubtle">The saved document follows your Bhodhix quotation format.</p></div><button type="button" onClick={async () => { await flushProjectTemplate(quoteDraft); setQuoteOpen(false); }} className="rounded-lg px-2 py-1 text-bhodix-textSubtle hover:bg-bhodix-hover">Close</button></div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5 text-xs text-bhodix-textMuted"><span>Client</span><select required value={quoteDraft.clientId} onChange={(e) => setQuoteDraft({ ...quoteDraft, clientId: e.target.value })} className={inputClass}><option value="">Choose client</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label className="space-y-1.5 text-xs text-bhodix-textMuted"><span>Project</span><select required value={quoteDraft.projectId} onChange={(e) => selectProject(e.target.value)} className={inputClass}><option value="">Choose a project</option>{projectList.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><div className="sm:col-span-2 text-[10px] text-bhodix-textSubtle">Milestone wording and project description <span className="font-medium text-indigo-400">{templateSaveState === 'saving' ? 'Saving…' : templateSaveState === 'saved' ? 'Saved for this project' : templateSaveState === 'error' ? 'Could not autosave' : 'autosave as you write'}</span></div><label className="space-y-1.5 text-xs text-bhodix-textMuted"><span>Issue date</span><input required type="date" value={quoteDraft.issueDate} onChange={(e) => setQuoteDraft({ ...quoteDraft, issueDate: e.target.value })} className={inputClass} /></label><label className="space-y-1.5 text-xs text-bhodix-textMuted"><span>Validity (days)</span><input required type="number" min="1" max="365" value={quoteDraft.validityDays} onChange={(e) => setQuoteDraft({ ...quoteDraft, validityDays: e.target.value })} className={inputClass} /></label></div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1.5 text-xs text-bhodix-textMuted"><span>Project title</span><input readOnly value={quoteDraft.title} placeholder="Choose a project above" className={`${inputClass} opacity-80`} /></label><label className="block space-y-1.5 text-xs text-bhodix-textMuted"><span>Project subtitle</span><input value={quoteDraft.subtitle} onChange={(e) => setQuoteDraft({ ...quoteDraft, subtitle: e.target.value })} placeholder="Short service descriptor" className={inputClass} /></label><label className="block space-y-1.5 text-xs text-bhodix-textMuted sm:col-span-2"><span>Project description / brief</span><textarea rows={2} value={quoteDraft.brief} onChange={(e) => setQuoteDraft({ ...quoteDraft, brief: e.target.value })} placeholder="Briefly describe the proposed work" className={inputClass} /></label></div>
      <div className="space-y-2"><div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-bhodix-text">Commercial summary</h3><button type="button" onClick={() => setQuoteDraft({ ...quoteDraft, items: [...quoteDraft.items, { description: '', details: '', amount: '' }] })} className="inline-flex items-center gap-1 text-[10px] text-indigo-400"><Plus className="h-3.5 w-3.5" />Add item</button></div>
        {quoteDraft.items.map((item, index) => <div key={index} className="grid gap-2 rounded-lg border border-bhodix-borderSubtle p-2 sm:grid-cols-[1fr_160px_36px]"><div className="grid gap-2"><input required aria-label="Description" value={item.description} onChange={(e) => setItem(index, 'description', e.target.value)} placeholder="Description" className={inputClass} /><input aria-label="Description details" value={item.details} onChange={(e) => setItem(index, 'details', e.target.value)} placeholder="Optional details or milestone breakdown" className={inputClass} /></div><label className="space-y-1.5 text-xs text-bhodix-textMuted"><span>Amount (₹)</span><input required aria-label="Amount in rupees" type="number" min="0" step="1" value={item.amount} onChange={(e) => setItem(index, 'amount', e.target.value)} placeholder="0" className={inputClass} /></label><button type="button" aria-label="Remove line item" disabled={quoteDraft.items.length === 1} onClick={() => setQuoteDraft({ ...quoteDraft, items: quoteDraft.items.filter((_, itemIndex) => itemIndex !== index) })} className="flex items-center justify-center rounded-lg text-bhodix-textSubtle hover:text-rose-400 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>)}
      </div>
      <section className="space-y-3 rounded-xl border border-bhodix-border p-3"><div className="flex flex-wrap items-end justify-between gap-3"><label className="min-w-52 flex-1 space-y-1.5 text-xs text-bhodix-textMuted"><span>How do you want to bill?</span><select value={quoteDraft.billingMode} onChange={(event) => changeBillingMode(event.target.value)} className={inputClass}><option value="single">One-time payment</option><option value="monthly">Monthly installments</option><option value="two-part">2 parts / milestones</option><option value="three-part">3 parts / milestones</option><option value="custom">Custom schedule</option></select></label>{quoteDraft.billingMode === 'monthly' && <label className="w-32 space-y-1.5 text-xs text-bhodix-textMuted"><span>Number of months</span><input type="number" min="1" max="48" value={quoteDraft.monthlyCount} onChange={(event) => setQuoteDraft((current) => ({ ...current, monthlyCount: event.target.value, paymentSchedule: paymentPlan('monthly', event.target.value) }))} className={inputClass} /> </label>}</div>
        <div className="space-y-2">{quoteDraft.paymentSchedule.map((item, index) => <div key={index} className="grid gap-2 rounded-lg border border-bhodix-borderSubtle p-2 sm:grid-cols-[1fr_112px_120px_36px]"><div className="grid gap-2"><input aria-label="Payment milestone" required value={item.label} onChange={(event) => setScheduleItem(index, 'label', event.target.value)} placeholder="Milestone or billing period" className={inputClass} /><input aria-label="Payment milestone details" value={item.details} onChange={(event) => setScheduleItem(index, 'details', event.target.value)} placeholder="When this payment is due" className={inputClass} /></div><select aria-label="Payment value type" value={item.mode} onChange={(event) => setScheduleItem(index, 'mode', event.target.value)} className={inputClass}><option value="percent">Percent</option><option value="amount">Amount ₹</option></select><label className="space-y-1.5 text-xs text-bhodix-textMuted"><span>{item.mode === 'percent' ? 'Percent of total' : 'Amount (₹)'}</span><input aria-label={item.mode === 'percent' ? 'Payment percentage' : 'Payment amount'} required type="number" min="0" max={item.mode === 'percent' ? '100' : undefined} step="0.01" value={item.value} onChange={(event) => setScheduleItem(index, 'value', event.target.value)} className={inputClass} /><span className="block text-[10px] text-bhodix-textSubtle">{inr(scheduleAmount(item))} of quotation total</span></label><button type="button" aria-label="Remove payment milestone" disabled={quoteDraft.paymentSchedule.length === 1 || quoteDraft.billingMode !== 'custom'} onClick={() => setQuoteDraft((current) => ({ ...current, paymentSchedule: current.paymentSchedule.filter((_, row) => row !== index) }))} className="flex items-center justify-center rounded-lg text-bhodix-textSubtle hover:text-rose-400 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>)}</div>
        {quoteDraft.billingMode === 'custom' && <button type="button" onClick={() => setQuoteDraft((current) => ({ ...current, paymentSchedule: [...current.paymentSchedule, { label: '', details: '', mode: 'percent', value: '' }] }))} className="inline-flex items-center gap-1 text-[10px] text-indigo-400"><Plus className="h-3.5 w-3.5" />Add payment row</button>}
        <p className={`text-[10px] ${totalOf(quoteDraft.items) > 0 && scheduledTotal > totalOf(quoteDraft.items) + 1 ? 'text-rose-400' : 'text-bhodix-textSubtle'}`}>{totalOf(quoteDraft.items) > 0 && scheduledTotal > totalOf(quoteDraft.items) + 1 ? 'Schedule is above quotation total · ' : ''}Scheduled: {inr(scheduledTotal)} · {scheduledPercent.toFixed(2)}% of quotation value</p>
      </section>
      <label className="block space-y-1.5 text-xs text-bhodix-textMuted"><span>Terms & conditions (one per line)</span><textarea rows={5} value={quoteDraft.terms.join('\n')} onChange={(e) => setQuoteDraft({ ...quoteDraft, terms: e.target.value.split('\n') })} className={inputClass} /></label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-bhodix-border pt-3"><p className="text-sm text-bhodix-textMuted">Estimated total <strong className="ml-2 text-lg text-bhodix-text">{inr(totalOf(quoteDraft.items))}</strong></p><button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"><FileText className="h-4 w-4" />{saving ? 'Saving…' : editingQuoteId ? 'Save quotation changes' : 'Save quotation draft'}</button></div>
    </form></div>}
  </div>;
}
