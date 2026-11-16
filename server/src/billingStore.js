const fs = require('fs');
const path = require('path');

const emptyBilling = () => ({ company: {}, clients: [], quotations: [], invoices: [], projectTemplates: [] });
const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const validList = (value, maxItems, maxText) => Array.isArray(value) && value.length <= maxItems && value.every((item) => typeof item === 'string' && item.length <= maxText);
const validItems = (items) => Array.isArray(items) && items.length > 0 && items.length <= 100 && items.every((item) =>
  item && typeof item === 'object' && text(item.description, 300) && Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0 && Number(item.amount) <= 1_000_000_000_000);
const validSchedule = (items) => Array.isArray(items) && items.length <= 100 && items.every((item) => item && text(item.label, 160) && typeof item.details === 'string' && item.details.length <= 1000 && ['amount', 'percent'].includes(item.mode) && Number.isFinite(Number(item.value)) && Number(item.value) >= 0 && Number(item.value) <= (item.mode === 'percent' ? 100 : 1_000_000_000_000));

function validateBilling(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Billing data must be an object');
  const { company = {}, clients = [], quotations = [], invoices = [], projectTemplates = [] } = value;
  if (!company || typeof company !== 'object' || Array.isArray(company)) throw new Error('Company billing profile is invalid');
  if (![clients, quotations, invoices, projectTemplates].every(Array.isArray)) throw new Error('Billing record collections are invalid');
  if (clients.length > 1000 || quotations.length > 5000 || invoices.length > 5000 || projectTemplates.length > 500) throw new Error('Billing record limit reached');
  if (!validList(company.quotationTerms || [], 20, 1000) || !validList(company.invoiceNotes || [], 20, 1000)) throw new Error('Company billing terms or invoice notes are invalid');

  const clientIds = new Set();
  for (const client of clients) {
    if (!client || !validId(client.id) || clientIds.has(client.id) || !text(client.name, 160)) throw new Error('Each client needs a unique ID and legal name');
    clientIds.add(client.id);
  }
  for (const [label, documents] of [['quotation', quotations], ['invoice', invoices]]) {
    const ids = new Set(); const numbers = new Set();
    for (const document of documents) {
      if (!document || !validId(document.id) || ids.has(document.id) || !text(document.number, 80) || numbers.has(document.number) || !text(document.title, 240) || !validItems(document.items)) throw new Error(`Each ${label} needs a unique ID, number, title, and at least one valid item`);
      ids.add(document.id); numbers.add(document.number);
      if (!clientIds.has(document.clientId)) throw new Error(`The ${label} refers to an unknown client`);
      if (!['draft', 'sent', 'accepted', 'declined', 'paid', 'overdue'].includes(document.status)) throw new Error(`Invalid ${label} status`);
      if (!validList(document.terms || [], 20, 1000) || !validList(document.notesList || [], 20, 1000)) throw new Error(`The ${label} terms or notes are invalid`);
      if ((document.projectId && !validId(document.projectId)) || (document.paymentSchedule !== undefined && !validSchedule(document.paymentSchedule))) throw new Error(`The ${label} payment schedule is invalid`);
      const quoteTotal = document.items.reduce((sum, item) => sum + Number(item.amount), 0);
      const scheduledTotal = (document.paymentSchedule || []).reduce((sum, item) => sum + (item.mode === 'percent' ? quoteTotal * Number(item.value) / 100 : Number(item.value)), 0);
      if (quoteTotal > 0 && scheduledTotal > quoteTotal + 1) throw new Error(`The ${label} payment schedule exceeds its total`);
    }
  }
  const logo = company.logoDataUrl || '';
  if (typeof logo !== 'string' || logo.length > 1_500_000 || (logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo))) throw new Error('Company logo must be a PNG, JPEG, or WebP image under 1 MB');

  const templateIds = new Set();
  for (const template of projectTemplates) {
    if (!template || !validId(template.projectId) || templateIds.has(template.projectId) || !['single', 'monthly', 'two-part', 'three-part', 'custom'].includes(template.billingMode) || !Array.isArray(template.items) || template.items.length > 100 || !Array.isArray(template.schedule) || template.schedule.length > 100) throw new Error('Project quotation defaults are invalid');
    templateIds.add(template.projectId);
    if (!template.items.every((item) => item && typeof item === 'object' && typeof item.description === 'string' && item.description.length <= 300 && typeof item.details === 'string' && item.details.length <= 1000)) throw new Error('Project quotation descriptions are invalid');
    if (!template.schedule.every((item) => item && typeof item.label === 'string' && item.label.length <= 160 && typeof item.details === 'string' && item.details.length <= 1000 && ['amount', 'percent'].includes(item.mode))) throw new Error('Project payment schedule defaults are invalid');
  }

  return {
    company: {
      name: text(company.name, 240), legalName: text(company.legalName, 240), documentPrefix: text(company.documentPrefix || 'BSLLP', 20).replace(/[^a-zA-Z0-9-]/g, '') || 'BSLLP', address: text(company.address, 1200),
      phonePrimary: text(company.phonePrimary, 80), phoneSecondary: text(company.phoneSecondary, 80), email: text(company.email, 240),
      gstin: text(company.gstin, 30), llpin: text(company.llpin, 40), pan: text(company.pan, 20), signatoryName: text(company.signatoryName, 160),
      bankName: text(company.bankName, 160), bankBranch: text(company.bankBranch, 240), accountNumber: text(company.accountNumber, 80),
      ifsc: text(company.ifsc, 20), upiId: text(company.upiId, 120), logoDataUrl: logo,
      quotationTerms: (company.quotationTerms || []).map((item) => text(item, 1000)), invoiceNotes: (company.invoiceNotes || []).map((item) => text(item, 1000))
    },
    clients: clients.map((client) => ({ id: client.id, name: text(client.name, 160), email: text(client.email, 240), phone: text(client.phone, 80), address: text(client.address, 1200), gstin: text(client.gstin, 30) })),
    quotations: quotations.map((document) => cleanDocument(document)),
    invoices: invoices.map((document) => cleanDocument(document)),
    projectTemplates: projectTemplates.map((template) => ({
      projectId: template.projectId, subtitle: text(template.subtitle, 240), brief: text(template.brief, 1200),
      billingMode: template.billingMode, monthlyCount: Math.min(48, Math.max(1, Number(template.monthlyCount) || 3)),
      items: template.items.map((item) => ({ description: text(item.description, 300), details: text(item.details, 1000) })),
      schedule: template.schedule.map((item) => ({ label: text(item.label, 160), details: text(item.details, 1000), mode: item.mode }))
    }))
  };
}

function cleanDocument(document) {
  return {
    id: document.id, number: text(document.number, 80), clientId: text(document.clientId, 80), projectId: text(document.projectId, 80),
    title: text(document.title, 240), subtitle: text(document.subtitle, 240), brief: text(document.brief, 1200), issueDate: text(document.issueDate, 30),
    validityDays: Math.min(365, Math.max(1, Number(document.validityDays) || 15)), validUntil: text(document.validUntil, 30),
    dueDate: text(document.dueDate, 30), quotationRef: text(document.quotationRef, 80), status: document.status,
    billingMode: ['single', 'monthly', 'two-part', 'three-part', 'custom'].includes(document.billingMode) ? document.billingMode : 'custom',
    monthlyCount: Math.min(48, Math.max(1, Number(document.monthlyCount) || 3)),
    paymentSchedule: (document.paymentSchedule || []).map((item) => ({ label: text(item.label, 160), details: text(item.details, 1000), mode: item.mode, value: Number(item.value) })),
    terms: (document.terms || []).map((item) => text(item, 1000)), notesList: (document.notesList || []).map((item) => text(item, 1000)),
    sourceQuotationId: text(document.sourceQuotationId, 80),
    items: document.items.map((item) => ({ description: text(item.description, 300), details: text(item.details, 1000), amount: Number(item.amount) }))
  };
}

function readBilling(vaultDir) {
  const file = path.join(vaultDir, 'billing', 'billing.json');
  if (!fs.existsSync(file)) return { revision: 0, updatedAt: '', data: emptyBilling() };
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { revision: Number.isInteger(saved.revision) ? saved.revision : 0, updatedAt: text(saved.updatedAt, 40), data: validateBilling(saved.data) };
}

function saveBilling(vaultDir, input, user) {
  const current = readBilling(vaultDir);
  if (!Number.isInteger(input?.expectedRevision) || input.expectedRevision !== current.revision) return null;
  const saved = { revision: current.revision + 1, updatedAt: new Date().toISOString(), updatedBy: text(user?.id, 80), data: validateBilling(input.billing) };
  const dir = path.join(vaultDir, 'billing');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'billing.json');
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(saved, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  return saved;
}

function saveProjectTemplate(vaultDir, projectId, template, user) {
  if (!validId(projectId) || !template || typeof template !== 'object' || Array.isArray(template)) throw new Error('Project quotation defaults are invalid');
  const current = readBilling(vaultDir);
  const updated = validateBilling({ ...current.data, projectTemplates: [...current.data.projectTemplates.filter((item) => item.projectId !== projectId), { ...template, projectId }] });
  const saved = { revision: current.revision + 1, updatedAt: new Date().toISOString(), updatedBy: text(user?.id, 80), data: updated };
  const dir = path.join(vaultDir, 'billing');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'billing.json');
  fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(saved, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(`${file}.${process.pid}.tmp`, file);
  return saved;
}

module.exports = { readBilling, saveBilling, saveProjectTemplate };
