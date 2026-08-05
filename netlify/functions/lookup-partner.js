/**
 * lookup-partner.js
 * Queries ClickUp for partner OR client data by email.
 * Searches: Partnership/Sponsorship Leads list AND Agreements list.
 * Returns documents, agreements, and portal access.
 *
 * Environment variables:
 *   CLICKUP_API_TOKEN
 *   STRIPE_SECRET_KEY (optional, for hosted invoice URL lookup)
 */

const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

// Lists to search
const PARTNER_LIST_ID = '901417758955';
const AGREEMENTS_LIST_ID = '901418268145';

// Custom field IDs
const CF = {
  // Partnership list
  partnerEmail: '218731dd-fa76-4a6b-87d1-51fccf0bcbe5',
  portalDocuments: 'c1d81331-97b9-42ba-8122-9b3e13a632e2',
  contactPerson: '8c6a242c-ab5b-4766-ab50-27f7cf660c4d',
  expectedRevenue: 'dc02a84a-93c0-4cdd-90a8-9745113c8d24',
  leadSource: '2674227a-b35a-4274-b15c-06d06d70d826',
  lastContacted: 'bf8213f6-f4ab-45ca-a38d-7d6ede464fb7',
  followUpAction: 'a4b6d357-f124-43e8-a581-5e7e9eab5606',
  leadStatusUpdate: '1a81182b-0bf0-45b4-89b6-8e1a139827b7',
  // Agreements list
  clientEmail: '3f38f15e-6aa4-4481-9365-d4a911d68195',
  clientName: '01b694ba-6da6-4e4c-a3d3-af4b96a7a0c5',
  eventName: '4299965c-96e2-430e-947a-ac16e9068aee',
  eventDate: '4006b42c-6597-49ea-bbb6-beb6bcc323b8',
  totalFee: 'a60f1fb7-4558-4cac-825c-abb9ea9a11e7',
  servicesRetained: '605ff2b7-983f-43e1-8f78-fc684d140f80',
  agreementDoc: 'b4a7de8c-d2d2-4f2b-b26e-8353d94f00b4',
  venueName: '25f7eed6-37ba-49e7-918a-e6040531b58f',
};

// Client portal URL map
const CLIENT_PORTALS = {
  'ryan.nelson.jrn@gmail.com': '/partner-docs/katie-ryan/',
  'kategeis@hotmail.com': '/partner-docs/katie-ryan/',
  'ashleyveenendaal23@gmail.com': '/partner-docs/katie-ryan/',
  'jesseradike1@gmail.com': '/partner-docs/jesse-zariah/',
  'spinsbooknook@gmail.com': '/partner-docs/aspen-hyrum/',
};

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
    // First check: is this a wedding/event client? (Agreements list)
    const clientResult = await findClient(email);
    if (clientResult) {
      return { statusCode: 200, headers, body: JSON.stringify({ partner: clientResult }) };
    }

    // Second check: is this a business partner? (Partnership list)
    const partnerResult = await findPartner(email);
    if (partnerResult) {
      return { statusCode: 200, headers, body: JSON.stringify({ partner: partnerResult }) };
    }

    // Check static portal map as fallback
    if (CLIENT_PORTALS[email]) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          partner: {
            name: 'Client',
            partnerType: 'client',
            portalUrl: CLIENT_PORTALS[email],
            documents: [],
            agreements: [{ title: 'Service Agreement', status: 'signed', viewUrl: CLIENT_PORTALS[email] }],
            invoices: [],
          }
        })
      };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ message: 'No account found for this email.' }) };

  } catch (err) {
    console.error('Lookup error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Internal error' }) };
  }
};

async function findClient(email) {
  const res = await fetch(
    `https://api.clickup.com/api/v2/list/${AGREEMENTS_LIST_ID}/task?archived=false&include_closed=true`,
    { headers: { 'Authorization': CLICKUP_API_TOKEN } }
  );
  if (!res.ok) return null;
  const data = await res.json();

  const task = (data.tasks || []).find(t => {
    // Match on Client Email field
    const emailField = (t.custom_fields || []).find(f => f.id === CF.clientEmail);
    if (emailField && typeof emailField.value === 'string' && emailField.value.toLowerCase() === email) return true;
    // Fallback: check description
    if (t.description && t.description.toLowerCase().includes(email)) return true;
    return false;
  });

  if (!task) return null;

  const getField = (id) => {
    const f = (task.custom_fields || []).find(cf => cf.id === id);
    if (!f || f.value === null || f.value === undefined) return null;
    if (f.type === 'currency') return typeof f.value === 'number' ? f.value : parseFloat(f.value);
    if (f.type === 'date' && f.value) { try { return new Date(Number(f.value)).toISOString().split('T')[0]; } catch { return null; } }
    if (typeof f.value === 'string') return f.value;
    return null;
  };

  const portalUrl = CLIENT_PORTALS[email] || getField(CF.agreementDoc) || null;
  const statusName = task.status ? (task.status.status || '').toLowerCase() : '';

  return {
    name: getField(CF.clientName) || task.name,
    partnerType: 'client',
    portalUrl: portalUrl,
    eventName: getField(CF.eventName),
    eventDate: getField(CF.eventDate),
    venue: getField(CF.venueName),
    documents: [],
    agreements: [{
      title: (getField(CF.eventName) || task.name) + ' — Service Agreement',
      type: 'Signature Celebration',
      summary: `Event at ${getField(CF.venueName) || 'TBD'}`,
      status: statusName === 'signed' || statusName === 'paid' ? 'signed' : 'pending',
      viewUrl: portalUrl,
    }],
    invoices: [],
  };
}

async function findPartner(email) {
  const res = await fetch(
    `https://api.clickup.com/api/v2/list/${PARTNER_LIST_ID}/task?archived=false&include_closed=true&subtasks=false&page=0`,
    { headers: { 'Authorization': CLICKUP_API_TOKEN, 'Content-Type': 'application/json' } }
  );
  if (!res.ok) return null;
  const data = await res.json();

  const partnerTask = (data.tasks || []).find(task => {
    const emailField = (task.custom_fields || []).find(f => f.id === CF.partnerEmail);
    if (emailField && typeof emailField.value === 'string' && emailField.value.toLowerCase() === email) return true;
    if (task.description && task.description.toLowerCase().includes(email)) return true;
    return false;
  });

  if (!partnerTask) return null;
  return formatPartnerData(partnerTask);
}

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

  const content = (task.description || '').toLowerCase();
  let partnerType = 'exchange';
  if (content.includes('sponsor')) partnerType = 'sponsor';
  else if (content.includes('vendor') || content.includes('preferred')) partnerType = 'vendor';

  const statusName = task.status ? (task.status.status || '').toLowerCase() : '';
  const agreementStatus = (statusName === 'complete' || statusName === 'signed') ? 'signed' : 'pending';

  const documents = [];
  const docsRaw = getField(CF.portalDocuments);
  if (docsRaw) {
    docsRaw.split('\n').filter(l => l.trim()).forEach(line => {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 2) documents.push({ title: parts[0], meta: 'Available for download', url: parts[1] });
      else if (parts[0].startsWith('http')) documents.push({ title: 'Document', meta: '', url: parts[0] });
      else documents.push({ title: parts[0], meta: '', url: null });
    });
  }

  const agreementUrl = AGREEMENT_URLS[task.name] || '/partner-docs/' + task.name.toLowerCase().replace(/\s+/g, '-') + '/agreement.html';

  const agreements = [{
    title: task.name + ' Partnership Agreement',
    type: partnerType === 'exchange' ? 'Service Exchange' : partnerType === 'sponsor' ? 'Sponsorship' : 'Preferred Vendor',
    summary: extractAgreementSummary(task.description),
    status: agreementStatus,
    signUrl: agreementStatus === 'pending' ? agreementUrl : null,
    viewUrl: agreementUrl,
  }];

  const invoices = [];
  const invoiceAmount = getField(CF.expectedRevenue);
  if (invoiceAmount && invoiceAmount > 0 && partnerType === 'sponsor') {
    invoices.push({ title: 'Sponsorship Payment', amount: invoiceAmount, description: task.name, status: 'due', paymentUrl: null });
  }

  return { name: task.name, partnerType, documents, agreements, invoices };
}

function extractAgreementSummary(description) {
  if (!description) return 'Partnership agreement details available upon review.';
  const lines = description.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const summary = lines.slice(0, 3).join(' ').replace(/<[^>]+>/g, '').trim();
  return summary.length > 200 ? summary.substring(0, 200) + '...' : summary || 'Partnership agreement details available upon review.';
}
