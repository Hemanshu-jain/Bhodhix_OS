import React from 'react';
import { ArrowLeft, Printer } from 'lucide-react';

const numberWords = (value) => {
  const ones = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const underThousand = (number) => {
    const parts = [];
    if (number >= 100) { parts.push(`${ones[Math.floor(number / 100)]} Hundred`); number %= 100; }
    if (number >= 20) { parts.push(`${tens[Math.floor(number / 10)]}${number % 10 ? `-${ones[number % 10]}` : ''}`); number %= 10; }
    if (number) parts.push(ones[number]);
    return parts.join(' ');
  };
  const indian = (number) => {
    if (number < 1000) return underThousand(number);
    for (const [size, label] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]) {
      if (number >= size) return `${indian(Math.floor(number / size))} ${label}${number % size ? ` ${indian(number % size)}` : ''}`;
    }
    return '';
  };
  const amount = Math.max(0, Math.round(Number(value) || 0));
  return `Rupees ${indian(amount) || 'Zero'} Only`;
};

const dateLabel = (value) => {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).format(date);
};
const money = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0));
const total = (items = []) => items.reduce((sum, item) => sum + Number(item.amount || 0), 0);

function CompanyBlock({ company, invoice = false }) {
  return <div className="billing-company-block">
    <strong>{company.legalName || company.name || 'Company legal name'}</strong>
    <div>{company.address || 'Registered address'}</div>
    {!invoice && <div>{[company.phonePrimary, company.phoneSecondary, company.email].filter(Boolean).join(' · ')}</div>}
    {invoice && <div>{company.gstin ? `GSTIN: ${company.gstin} · ` : ''}LLPIN: {company.llpin || '—'} · PAN: {company.pan || '—'}</div>}
  </div>;
}

export default function BillingDocument({ type, document, client, company, onBack, onPrint }) {
  const isQuote = type === 'quotation';
  const amount = total(document.items);
  const companyName = company.legalName || company.name || 'Company legal name';
  const terms = isQuote ? document.terms : document.notesList;
  return <div className="billing-preview-shell">
    <div className="billing-screen-controls">
      <button onClick={onBack} className="inline-flex items-center gap-2 rounded-lg border border-bhodix-border px-3 py-2 text-xs text-bhodix-textMuted hover:bg-bhodix-hover"><ArrowLeft className="h-4 w-4" />Back to {isQuote ? 'quotations' : 'invoices'}</button>
      <button onClick={onPrint} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"><Printer className="h-4 w-4" />Print / Save PDF</button>
    </div>
    <article id="billing-print" className={`billing-document ${isQuote ? 'billing-quotation' : 'billing-invoice'}`}>
      {isQuote ? <>
        <header className="billing-quote-header">
          <div className="billing-logo"><img src={company.logoDataUrl || '/bhodhix-logo.png'} alt="Bhodhix Software LLP logo" /></div>
          <div className="billing-company-head"><strong>{companyName}</strong><span>{company.address}</span><span>{[company.phonePrimary, company.phoneSecondary, company.email].filter(Boolean).join(' · ')}</span></div>
        </header>
        <div className="billing-rule billing-heavy" />
        <section className="billing-title-row">
          <div><div className="billing-eyebrow">Commercial Proposal</div><h1>Quotation</h1></div>
          <dl className="billing-meta"><div><dt>Quotation No.</dt><dd>{document.number}</dd></div><div><dt>Date</dt><dd>{dateLabel(document.issueDate)}</dd></div><div><dt>Valid for</dt><dd>{document.validityDays || 15} days</dd></div></dl>
        </section>
        <section className="billing-parties billing-quote-parties">
          <div><div className="billing-eyebrow">Prepared for</div><strong>{client.name}</strong>{client.address && <span>{client.address}</span>}{client.gstin && <span>GSTIN: {client.gstin}</span>}</div>
          <div><div className="billing-eyebrow">Prepared by</div><strong>{companyName}</strong><span>{company.address}</span>{company.gstin && <span>GSTIN: {company.gstin}</span>}</div>
        </section>
        <section className="billing-project"><div className="billing-project-heading"><strong>{document.title}</strong>{document.subtitle && <span>{document.subtitle}</span>}</div>{document.brief && <p>{document.brief}</p>}</section>
        <DocumentItems items={document.items} heading="Commercial Summary" />
        <TotalBlock amount={amount} />
        {document.paymentSchedule?.length > 0 && <PaymentSchedule items={document.paymentSchedule} total={amount} />}
        <TermsBlock heading="Terms & Conditions" items={terms} />
        <section className="billing-signatures billing-two-signatures"><div><strong>Accepted for and on behalf of the Client</strong><div className="billing-sign-line" /><span>Name & designation · Signature · Date</span></div><div><strong>For {companyName}</strong><div className="billing-sign-line" /><span>{company.signatoryName || 'Authorised signatory'} · Signature · Date</span></div></section>
      </> : <>
        <section className="billing-title-row billing-invoice-title">
          <div><div className="billing-eyebrow">Payment Request</div><h1>Invoice</h1></div>
          <dl className="billing-meta"><div><dt>Invoice No.</dt><dd>{document.number}</dd></div><div><dt>Invoice date</dt><dd>{dateLabel(document.issueDate)}</dd></div><div><dt>Due date</dt><dd>{dateLabel(document.dueDate)}</dd></div><div><dt>Quotation ref.</dt><dd>{document.quotationRef || '—'}</dd></div></dl>
        </section>
        <section className="billing-parties billing-invoice-parties">
          <div><div className="billing-eyebrow">Billed to</div><strong>{client.name}</strong>{client.address && <span>{client.address}</span>}{client.gstin && <span>GSTIN: {client.gstin}</span>}</div>
          <div><div className="billing-eyebrow">Billed by</div><CompanyBlock company={company} invoice /></div>
        </section>
        <DocumentItems items={document.items} heading="Particulars" />
        <TotalBlock amount={amount} invoice />
        <section className="billing-payment"><h2>Payment Details</h2><div className="billing-payment-grid"><dl><div><dt>Account name</dt><dd>{companyName}</dd></div><div><dt>Bank & branch</dt><dd>{[company.bankName, company.bankBranch].filter(Boolean).join(', ') || '—'}</dd></div><div><dt>Account no.</dt><dd>{company.accountNumber || '—'}</dd></div><div><dt>IFSC</dt><dd>{company.ifsc || '—'}</dd></div></dl><dl><div><dt>UPI ID</dt><dd>{company.upiId || '—'}</dd></div><div><dt>Pay by</dt><dd>Bank transfer / UPI</dd></div><div><dt>Reference</dt><dd>Invoice no. above</dd></div></dl></div></section>
        <TermsBlock heading="Notes" items={terms} />
        <section className="billing-signatures"><div><strong>For {companyName}</strong><div className="billing-sign-line" /><span>{company.signatoryName || 'Authorised signatory'} · Signature · Date</span></div></section>
      </>}
      <footer className="billing-footer"><span>{companyName}{company.phonePrimary ? ` · ${company.phonePrimary}` : ''}{company.phoneSecondary ? ` · ${company.phoneSecondary}` : ''}{company.email ? ` · ${company.email}` : ''}</span><span>This is a computer-generated {isQuote ? 'quotation' : 'invoice'}.</span></footer>
    </article>
  </div>;
}

function DocumentItems({ items, heading }) {
  return <section className="billing-items"><h2>{heading}</h2><table><thead><tr><th>#</th><th>Description</th><th>Amount (₹)</th></tr></thead><tbody>{items.map((item, index) => <tr key={`${item.description}-${index}`}><td>{index + 1}</td><td><strong>{item.description}</strong>{item.details && <span>{item.details}</span>}</td><td>{money(item.amount)}</td></tr>)}</tbody></table></section>;
}

function TotalBlock({ amount, invoice = false }) {
  return <section className="billing-total"><div className="billing-total-row"><strong>{invoice ? 'Total Due' : 'Total Payable'}</strong><strong>₹ {money(amount)}</strong></div><p><strong>Amount in words:</strong> {numberWords(amount)}</p></section>;
}

function PaymentSchedule({ items, total }) {
  return <section className="billing-payment-schedule"><h2>Payment Schedule</h2><table><thead><tr><th>#</th><th>Milestone / period</th><th>Billing basis</th><th>Amount (₹)</th></tr></thead><tbody>{items.map((item, index) => {
    const amount = item.mode === 'percent' ? total * Number(item.value || 0) / 100 : Number(item.value || 0);
    return <tr key={`${item.label}-${index}`}><td>{index + 1}</td><td><strong>{item.label}</strong>{item.details && <span>{item.details}</span>}</td><td>{item.mode === 'percent' ? `${Number(item.value || 0)}%` : 'Fixed amount'}</td><td>{money(amount)}</td></tr>;
  })}</tbody></table></section>;
}

function TermsBlock({ heading, items }) {
  return <section className="billing-terms"><h2>{heading}</h2><ol>{items.map((item, index) => {
    const match = item.match(/^([^.!?]{1,60}\.)\s*(.*)$/);
    return <li key={`${item}-${index}`}>{match ? <><strong>{match[1]}</strong> {match[2]}</> : item}</li>;
  })}</ol></section>;
}
