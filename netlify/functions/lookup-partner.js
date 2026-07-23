/**
 * lookup-partner.js
 * Netlify Function: Queries ClickUp Partnership/Sponsorship Leads list by partner email.
 * Returns documents, agreements, and invoice/payment data.
 * 
 * Environment variables required:
 *   CLICKUP_API_TOKEN - ClickUp API token
 *   STRIPE_SECRET_KEY - Stripe secret key (for hosted invoice URL lookup)
 * 
 * ClickUp List: Partnership/Sponsorship Leads (objectID format for API)
 * Custom fields map partner data. Update CF object if field IDs change.
 */

const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PARTNER_LIST_ID = '901417758955'; // Partnership/Sponsorship Leads list (objectID)

// Custom field IDs from the Partnership/Sponsorship Leads list
const CF = {
  partnerEmail: '218731dd-fa76-4a6b-87d1-51fccf0bcbe5', // Partner Email (email type)
  portalDocuments: 'c1d81331-97b9-42ba-8122-9b3e13a632e2', // Portal Documents (multi-line text, format: Title | URL)
  contactPerson: '8c6a242c-ab5b-4766-ab50-27f7cf660c4d', // Contact Person (short text)
  expectedRevenue: 'dc02a84a-93c0-4cdd-90a8-9745113c8d24', // Expected Revenue (currency/USD)
  leadSource: '2674227a-b35a-4274-b15c-06d06d70d826', // Lead Source (dropdown)
  lastContacted: 'bf8213f6-f4ab-45ca-a38d-7d6ede464fb7', // Last Contacted (date)
  followUpAction: 'a4b6d357-f124-43e8-a581-5e7e9eab5606', // Follow-Up Action (text)
  leadStatusUpdate: '1a81182b-0bf0-45b4-89b6-8e1a139827b7', // Lead Status Update (text)
};

// Map partner task names to their agreement page URLs
const AGREEMENT_URLS = {
  'Donnielle Schroeder': '/partner-docs/donnielle/agreement.html',
};

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid request' }) }; }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return { statusCode: 400, headers, body: JSON.stringify({ message: 'Valid email required' }) };
  if (!CLICKUP_API_TOKEN) return { statusCode: 500, headers, body: JSON.stringify({ message: 'Server configuration error' }) };

  try {
    // Fetch tasks from the Partnership/Sponsorship Leads list
    const res = await fetch(
      `https://api.clickup.com/api/v2/list/${PARTNER_LIST_ID}/task?archived=false&include_closed=true&subtasks=false&page=0`,
      {
        method: 'GET',
        headers: { 'Authorization': CLICKUP_API_TOKEN, 'Content-Type': 'application/json' },
      }
    );

    if (!res.ok) {
      const errBody = await res.text();
      console.error('ClickUp API error:', res.status, errBody);
      return { statusCode: 502, headers, body: JSON.stringify({ message: 'Unable to retrieve partner data' }) };
    }

    const data = await res.json();

    // Find partner task by email match on the Partner Email custom field
    const partnerTask = (data.tasks || []).find(task => {
      const emailField = (task.custom_fields || []).find(f => f.id === CF.partnerEmail);
      if (emailField && typeof emailField.value === 'string' && emailField.value.toLowerCase() === email) return true;
      // Fallback: check task description for email mention
      const desc = (task.description || '').toLowerCase();
      if (desc.includes(email)) return true;
      return false;
    });

    if (!partnerTask) {
      return { statusCode: 404, headers, body: JSON.stringify({ message: 'No partner account found for this email.' }) };
    }

    // Format the partner data
    const partner = formatPartnerData(partnerTask);
    return { statusCode: 200, headers, body: JSON.stringify({ partner }) };

  } catch (err) {
    console.error('Lookup error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Internal error' }) };
  }
};

function formatPartnerData(task) {
  const getField = (id) => {
    if (!id) return null;
    const f = (task.custom_fields || []).find(cf => cf.id === id);
    if (!f || f.value === null || f.value === undefined) return null;
    if (f.type === 'drop_down' && f.type_config && f.type_config.options && typeof f.value === 'number') {
      const opt = f.type_config.options.find(o => o.orderindex === f.value);
      return opt ? opt.name : null;
    }
    if (f.type === 'currency') { const n = typeof f.value === 'number' ? f.value : parseFloat(f.value); return isNaN(n) ? null : n; }
    if (f.type === 'date' && f.value) { try { return new Date(Number(f.value)).toISOString().split('T')[0]; } catch { return null; } }
    if (typeof f.value === 'string') return f.value;
    if (typeof f.value === 'number') return f.value;
    return null;
  };

  // Determine partner type from task content or custom field
  const content = (task.description || '').toLowerCase();
  let partnerType = 'exchange'; // default
  if (content.includes('sponsor')) partnerType = 'sponsor';
  else if (content.includes('vendor') || content.includes('preferred')) partnerType = 'vendor';

  // Determine agreement status from task status
  const statusName = task.status ? (task.status.status || '').toLowerCase() : '';
  const agreementStatus = (statusName === 'complete' || statusName === 'signed') ? 'signed' : 'pending';

  // Build documents from Portal Documents field (format: "Title | URL" per line)
  const documents = [];
  const docsRaw = getField(CF.portalDocuments);
  if (docsRaw) {
    const lines = docsRaw.split('\n').filter(l => l.trim());
    lines.forEach(line => {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 2) {
        documents.push({ title: parts[0], meta: 'Available for download', url: parts[1] });
      } else if (parts.length === 1 && parts[0].startsWith('http')) {
        documents.push({ title: 'Document', meta: '', url: parts[0] });
      } else {
        documents.push({ title: parts[0], meta: '', url: null });
      }
    });
  }

  // Get agreement URL from the map, or generate a slug-based path
  const agreementUrl = AGREEMENT_URLS[task.name] || '/partner-docs/' + task.name.toLowerCase().replace(/\s+/g, '-') + '/agreement.html';

  // Build agreements array
  const agreements = [{
    title: task.name + ' Partnership Agreement',
    type: partnerType === 'exchange' ? 'Service Exchange' : partnerType === 'sponsor' ? 'Sponsorship' : 'Preferred Vendor',
    summary: extractAgreementSummary(task.description),
    status: agreementStatus,
    signUrl: agreementStatus === 'pending' ? agreementUrl : null,
    viewUrl: agreementUrl,
  }];

  // Build invoices array from Expected Revenue field
  const invoices = [];
  const invoiceAmount = getField(CF.expectedRevenue);

  if (invoiceAmount && invoiceAmount > 0 && partnerType === 'sponsor') {
    invoices.push({
      title: 'Sponsorship Payment',
      amount: invoiceAmount,
      description: task.name,
      status: 'due',
      paymentUrl: null,
    });
  }

  return {
    name: task.name,
    partnerType,
    documents,
    agreements,
    invoices,
  };
}

function extractAgreementSummary(description) {
  if (!description) return 'Partnership agreement details available upon review.';
  const lines = description.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const summary = lines.slice(0, 3).join(' ').replace(/<[^>]+>/g, '').trim();
  return summary.length > 200 ? summary.substring(0, 200) + '...' : summary || 'Partnership agreement details available upon review.';
}
