// netlify/functions/stripe-webhook.js
// Stripe webhook: updates ClickUp Payment Status when payment is received
//
// ENV VARS:
//   STRIPE_WEBHOOK_SECRET - Stripe webhook signing secret (whsec_...)
//   STRIPE_SECRET_KEY     - Stripe secret key
//   CLICKUP_API_TOKEN     - ClickUp API token
//
// Setup in Stripe Dashboard:
//   1. Go to Developers > Webhooks > Add endpoint
//   2. URL: https://ampersoundmediagroup.com/.netlify/functions/stripe-webhook
//   3. Events: checkout.session.completed
//   4. Copy the signing secret to STRIPE_WEBHOOK_SECRET env var

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const CHAT_CHANNEL_ID = process.env.CLICKUP_CHAT_CHANNEL_ID;

// Payment Status field option IDs (inherited from Pipeline Management folder)
const PAYMENT_STATUS_FIELD = '96105ecf-6396-4fb1-90aa-93b37c9dfc48';
const PAYMENT_RECEIVED_OPTION = '7601cdf4-5cee-49ef-a8bf-802350a5bdcc'; // "Payment Recieved"

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Verify Stripe webhook signature
async function verifySignature(payload, sigHeader) {
  if (!STRIPE_WEBHOOK_SECRET) return true; // Skip verification if no secret (dev mode)

  const crypto = require('crypto');
  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [key, val] = part.split('=');
    acc[key] = val;
    return acc;
  }, {});

  const timestamp = parts['t'];
  const signature = parts['v1'];

  if (!timestamp || !signature) return false;

  // Check timestamp tolerance (5 min)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSig = crypto
    .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
    .update(signedPayload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSig, 'hex')
  );
}

// Notify Chat channel about payment
async function notifyPayment(session) {
  if (!CHAT_CHANNEL_ID || !CLICKUP_API_TOKEN) return;

  const clientName = session.metadata?.client || session.customer_details?.name || 'Client';
  const eventName = session.metadata?.event || '';
  const amount = session.amount_total ? `$${(session.amount_total / 100).toLocaleString()}` : 'Unknown';
  const method = session.payment_method_types?.[0] === 'us_bank_account' ? 'ACH' : 'Card';

  const msg = `\ud83d\udcb0 **Payment Received**\n\n**Client:** ${clientName}\n**Event:** ${eventName}\n**Amount:** ${amount}\n**Method:** ${method}\n**Status:** Funds received`;

  try {
    await fetch(`https://api.clickup.com/api/v3/chat/${CHAT_CHANNEL_ID}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': CLICKUP_API_TOKEN },
      body: JSON.stringify({ content: msg }),
    });
  } catch (e) { console.error('Chat notification failed:', e.message); }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method not allowed' }) };

  const sigHeader = event.headers['stripe-signature'] || event.headers['Stripe-Signature'] || '';
  const payload = event.body;

  // Verify webhook signature
  try {
    const valid = await verifySignature(payload, sigHeader);
    if (!valid) {
      console.error('Invalid Stripe signature');
      return { statusCode: 401, headers, body: JSON.stringify({ message: 'Invalid signature' }) };
    }
  } catch (e) {
    console.error('Signature verification error:', e.message);
    return { statusCode: 401, headers, body: JSON.stringify({ message: 'Signature error' }) };
  }

  let stripeEvent;
  try { stripeEvent = JSON.parse(payload); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON' }) }; }

  // Only handle checkout.session.completed
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, headers, body: JSON.stringify({ message: 'Event ignored', type: stripeEvent.type }) };
  }

  const session = stripeEvent.data?.object;
  if (!session) return { statusCode: 200, headers, body: JSON.stringify({ message: 'No session data' }) };

  console.log('Payment received:', session.id, session.amount_total, session.metadata);

  // Get taskId from metadata
  const taskId = session.metadata?.taskId;

  if (taskId && CLICKUP_API_TOKEN) {
    try {
      // Update Payment Status on the task to "Payment Recieved"
      const updateRes = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': CLICKUP_API_TOKEN },
        body: JSON.stringify({
          custom_fields: [
            { id: PAYMENT_STATUS_FIELD, value: PAYMENT_RECEIVED_OPTION }
          ]
        }),
      });

      if (!updateRes.ok) {
        const err = await updateRes.text();
        console.error('ClickUp update failed:', updateRes.status, err);
      } else {
        console.log('Payment Status updated for task:', taskId);
      }
    } catch (e) {
      console.error('ClickUp update error:', e.message);
    }
  } else {
    console.log('No taskId in metadata, skipping ClickUp update');
  }

  // Notify Chat
  await notifyPayment(session);

  return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
};