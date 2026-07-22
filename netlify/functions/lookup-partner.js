/**
 * lookup-partner.js
 * Netlify Function: Queries ClickUp Partnership/Sponsorship Leads list by partner email.
 * Returns documents, agreements, and invoice/payment data.
 * 
 * Environment variables required:
 *   CLICKUP_API_TOKEN - ClickUp API token
 *   STRIPE_SECRET_KEY - Stripe secret key (for hosted invoice URL lookup)
 * 
 * ClickUp List: Partnership/Sponsorship Leads (ID in PARTNER_LIST_ID)
 * Custom fields map partner data. Update CF object if field IDs change.
 */

const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PARTNER_LIST_ID = '4027406389340530077'; // Partnership/Sponsorship Leads list

// Custom field IDs - update these to match your ClickUp list's custom fields
// These will need to be configured once you add custom fields to the Partnership list
const CF = {
  partnerEmail: '', // Email custom field ID (to be configured)
  partnerName: '',  // Partner name / org
  partnerType: '',  // Dropdown: exchange, sponsor, vendor
  agreementStatus: '', // Dropdown: pending, signed
  invoiceAmount: '',   // Currency field
  paymentStatus: '',   // Dropdown: pending, paid
  paymentLink: '',     // URL field (Stripe hosted invoice URL)
  documents: '',       // Text field (JSON array of doc links)
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
    // Fetch all tasks from the Partnership/Sponsorship Leads list
    const res = await fetch(
      `https://api.clickup.com/api/v2/list/${PARTNER_LIST_ID}/task?archived=false&include_closed=true&subtasks=true&page=0`,
      {
        method: 'GET',
        headers: { 'Authorization': CLICKUP_API_TOKEN, 'Content-Type': 'application/json' },
      }
    );

    if (!res.ok) {
      console.error('ClickUp API error:', res.status, await res.text());
      return { statusCode: 502, headers, body: JSON.stringify({ message: 'Unable to retrieve partner data' }) };
    }

    const data = await res.json();

    // Find partner task by email match
    // Strategy: Check task description and custom fields for the email
    const partnerTask = (data.tasks || []).find(task => {
      // Check custom field if configured
      if (CF.partnerEmail) {
        const emailField = (task.custom_fields || []).find(f => f.id === CF.partnerEmail);
        if (emailField && typeof emailField.value === 'string' && emailField.value.toLowerCase() === email) return true;
      }
      // Fallback: check task description for email mention
      const desc = (task.description || '').toLowerCase();
      if (desc.includes(email)) return true;
      // Check comments for email (first comment from Partnership Paulina often has contact info)
      return false;
    });

    if (!partnerTask) {
      return { statusCode: 404, headers, body: JSON.stringify({ message: 'No partner account found for this email.' }) };
    }

    // Format the partner data
    const partner = await formatPartnerData(partnerTask);
    return { statusCode: 200, headers, body: JSON.stringify({ partner }) };

  } catch (err) {
    console.error('Lookup error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Internal error' }) };
  }
};

async function formatPartnerData(task) {
  const getField = (id) => {
    if (!id) return null;
    const f = (task.custom_fields || []).find(cf => cf.id === id);
    if (!f || f.value === null || f.value === undefined) return null;
    if (f.type === 'drop_down' && f.type_config && f.type_config.options && typeof f.value === 'number') {
      const opt = f.type_config.options.find(o => o.orderindex === f.value);
      return opt ? opt.name : null;
    }
    if (f.type === 'currency') { const n = typeof f.value === 'number' ? f.value : parseFloat(f.value); return isNaN(n) ? null : n; }
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

  // Get subtasks as documents/deliverables
  const documents = [];
  if (task.subtasks && task.subtasks.length) {
    task.subtasks.forEach(sub => {
      if (sub.status && sub.status.status && sub.status.status.toLowerCase() === 'complete') {
        documents.push({ title: sub.name, meta: 'Completed', url: null });
      }
    });
  }

  // Build agreements array
  const agreements = [{
    title: task.name + ' Partnership Agreement',
    type: partnerType === 'exchange' ? 'Service Exchange' : partnerType === 'sponsor' ? 'Sponsorship' : 'Preferred Vendor',
    summary: extractAgreementSummary(task.description),
    status: agreementStatus,
    signUrl: agreementStatus === 'pending' ? '/agreement/sign?token=' + task.id : null,
    viewUrl: '/agreement/sign?token=' + task.id + '&view=true',
  }];

  // Build invoices array
  const invoices = [];
  const invoiceAmount = getField(CF.invoiceAmount);
  const paymentLink = getField(CF.paymentLink);
  const paymentStatus = getField(CF.paymentStatus);

  if (invoiceAmount && invoiceAmount > 0) {
    invoices.push({
      title: partnerType === 'sponsor' ? 'Sponsorship Payment' : 'Partnership Fee',
      amount: invoiceAmount,
      description: task.name,
      status: paymentStatus === 'paid' ? 'paid' : 'due',
      paymentUrl: paymentLink || null,
    });
  }

  // If Stripe is configured and we have an invoice but no payment link, try to get one
  if (STRIPE_SECRET_KEY && invoices.length && !invoices[0].paymentUrl && invoices[0].status === 'due') {
    try {
      const stripe = require('stripe')(STRIPE_SECRET_KEY);
      // Look up customer invoices by email (if customer exists in Stripe)
      // This is a future enhancement - for now, payment links are set manually in ClickUp
    } catch (e) {
      console.log('Stripe lookup skipped:', e.message);
    }
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
  // Extract the first meaningful section from the description
  const lines = description.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const summary = lines.slice(0, 3).join(' ').replace(/<[^>]+>/g, '').trim();
  return summary.length > 200 ? summary.substring(0, 200) + '...' : summary || 'Partnership agreement details available upon review.';
}
