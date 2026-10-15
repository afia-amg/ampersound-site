// netlify/functions/stripe-webhook.js
// Stripe webhook: logs payments in ClickUp straight from Stripe, so a payment
// is recorded even if the client closes the tab before the portal redirect.
//
// Reads payment link metadata (copied onto every Checkout Session):
//   clickup_task_id (or legacy taskId), deal_task_id, client, event,
//   installment, installments_total
// Then on that task: posts a payment comment, sets Payment Status to
// "Payment Recieved", and moves it to "completed". Also comments on the deal
// task and pings the Chat channel when configured.
//
// Safe to receive twice (Stripe retries, or the portal redirect landing too):
// a task already "completed" is left alone.
//
// ENV VARS:
//   STRIPE_WEBHOOK_SECRET   - Stripe webhook signing secret (whsec_...). Required.
//   CLICKUP_API_TOKEN       - ClickUp API token
//   CLICKUP_CHAT_CHANNEL_ID - optional, Chat channel for payment pings
//
// Stripe endpoint: https://ampersoundmediagroup.com/.netlify/functions/stripe-webhook
// Events: checkout.session.completed, checkout.session.async_payment_succeeded

const crypto = require('crypto');

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const CHAT_CHANNEL_ID = process.env.CLICKUP_CHAT_CHANNEL_ID;
const CLICKUP_BASE = 'https://api.clickup.com/api/v2';
const DONE = 'completed';

// Payment Status field option IDs (inherited from Pipeline Management folder)
const PAYMENT_STATUS_FIELD = '96105ecf-6396-4fb1-90aa-93b37c9dfc48';
const PAYMENT_RECEIVED_OPTION = '7601cdf4-5cee-49ef-a8bf-802350a5bdcc'; // "Payment Recieved"

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Verify Stripe webhook signature. No secret means no trust: without it anyone
// could post a fake "payment" and close a client's task.
function verifySignature(payload, sigHeader) {
  if (!STRIPE_WEBHOOK_SECRET || !sigHeader) return false;

  let timestamp = null;
  const sigs = [];
  sigHeader.split(',').forEach((part) => {
    const i = part.indexOf('=');
    const key = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    if (key === 't') timestamp = val;
    if (key === 'v1') sigs.push(val);
  });
  if (!timestamp || !sigs.length) return false;

  // Check timestamp tolerance (5 min)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

  const expected = Buffer.from(
    crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${payload}`, 'utf8').digest('hex'),
    'hex'
  );
  return sigs.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

async function clickup(path, opts = {}) {
  const res = await fetch(CLICKUP_BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: CLICKUP_API_TOKEN },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ClickUp ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

function postComment(taskId, text) {
  return clickup(`/task/${taskId}/comment`, { method: 'POST', body: JSON.stringify({ comment_text: text }) });
}

// Notify Chat channel about payment
async function notifyPayment(session, label) {
  if (!CHAT_CHANNEL_ID || !CLICKUP_API_TOKEN) return;

  const clientName = session.metadata?.client || session.customer_details?.name || 'Client';
  const eventName = session.metadata?.event || '';
  const amount = session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : 'Unknown';
  const method = session.payment_method_types?.[0] === 'us_bank_account' ? 'ACH' : 'Card';

  const msg = `\ud83d\udcb0 **${label} Received**\n\n**Client:** ${clientName}\n**Event:** ${eventName}\n**Amount:** ${amount}\n**Method:** ${method}\n**Status:** Funds received`;

  try {
    await fetch(`https://api.clickup.com/api/v3/chat/${CHAT_CHANNEL_ID}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: CLICKUP_API_TOKEN },
      body: JSON.stringify({ content: msg }),
    });
  } catch (e) { console.error('Chat notification failed:', e.message); }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method not allowed' }) };

  if (!STRIPE_WEBHOOK_SECRET || !CLICKUP_API_TOKEN) {
    console.error('Missing STRIPE_WEBHOOK_SECRET or CLICKUP_API_TOKEN');
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Server config error' }) };
  }

  const sigHeader = event.headers['stripe-signature'] || event.headers['Stripe-Signature'] || '';
  const payload = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';

  if (!verifySignature(payload, sigHeader)) {
    console.error('Invalid Stripe signature');
    return { statusCode: 401, headers, body: JSON.stringify({ message: 'Invalid signature' }) };
  }

  let stripeEvent;
  try { stripeEvent = JSON.parse(payload); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON' }) }; }

  const handled = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
  if (!handled.includes(stripeEvent.type)) {
    return { statusCode: 200, headers, body: JSON.stringify({ message: 'Event ignored', type: stripeEvent.type }) };
  }

  const session = stripeEvent.data?.object;
  if (!session) return { statusCode: 200, headers, body: JSON.stringify({ message: 'No session data' }) };

  // Bank transfers fire "completed" while still pending; log them when
  // async_payment_succeeded arrives instead.
  if (session.payment_status !== 'paid') {
    console.log('Session not paid yet:', session.id, session.payment_status);
    return { statusCode: 200, headers, body: JSON.stringify({ message: 'Pending' }) };
  }

  const md = session.metadata || {};
  const taskId = md.clickup_task_id || md.taskId;
  const label = md.installment
    ? `Installment ${md.installment}${md.installments_total ? ' of ' + md.installments_total : ''}`
    : 'Payment';

  console.log('Payment received:', session.id, session.amount_total, md);

  if (!taskId) {
    console.log('No task id in metadata, skipping ClickUp update');
    await notifyPayment(session, label);
    return { statusCode: 200, headers, body: JSON.stringify({ received: true, untagged: true }) };
  }

  try {
    const task = await clickup(`/task/${taskId}`);
    if (!task) {
      console.error('Task not found:', taskId);
      return { statusCode: 200, headers, body: JSON.stringify({ received: true, message: 'Task not found' }) };
    }
    if ((task.status?.status || '').toLowerCase() === DONE) {
      console.log('Already logged, skipping:', taskId);
      return { statusCode: 200, headers, body: JSON.stringify({ received: true, duplicate: true }) };
    }

    const amount = typeof session.amount_total === 'number'
      ? `$${(session.amount_total / 100).toFixed(2)}`
      : (md.amount ? `$${md.amount}` : 'amount confirmed');
    const date = new Date((stripeEvent.created || Date.now() / 1000) * 1000).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Denver',
    });
    const text = `\ud83d\udcb0 **${label} received via Stripe**\n\n` +
      `Amount: ${amount}\n` +
      `Client: ${md.client || session.customer_details?.email || 'Client'}\n` +
      `Date: ${date}\n` +
      `Stripe payment: ${session.payment_intent || session.id}`;

    await postComment(taskId, text);

    try {
      await clickup(`/task/${taskId}/field/${PAYMENT_STATUS_FIELD}`, {
        method: 'POST', body: JSON.stringify({ value: PAYMENT_RECEIVED_OPTION }),
      });
    } catch (e) { console.error('Payment Status field update failed (continuing):', e.message); }

    try {
      await clickup(`/task/${taskId}`, { method: 'PUT', body: JSON.stringify({ status: DONE }) });
    } catch (e) { console.error('Status update failed (continuing):', e.message); }

    if (md.deal_task_id) {
      try { await postComment(md.deal_task_id, text); }
      catch (e) { console.error('Deal comment failed (continuing):', e.message); }
    }

    console.log(`Logged ${label} on ${taskId}`);
  } catch (e) {
    // A 500 makes Stripe retry later, which is what we want for a ClickUp blip.
    console.error('ClickUp update error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }

  await notifyPayment(session, label);
  return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
};
