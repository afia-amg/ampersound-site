// netlify/functions/create-payment-link.js
// Creates a Stripe Payment Link for a client deposit
//
// ENV VARS:
//   STRIPE_SECRET_KEY - Stripe secret key (sk_live_... or sk_test_...)
//
// POST body:
//   { clientName, eventName, amount (in dollars), taskId (optional) }
//
// Returns:
//   { url: "https://buy.stripe.com/...", id: "plink_..." }

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method not allowed' }) };
  if (!STRIPE_SECRET_KEY) return { statusCode: 500, headers, body: JSON.stringify({ message: 'Stripe not configured' }) };

  let data;
  try { data = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid request' }) }; }

  const { clientName, eventName, amount, taskId } = data;

  if (!amount || !clientName) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'clientName and amount required' }) };
  }

  const amountCents = Math.round(Number(amount) * 100);
  if (isNaN(amountCents) || amountCents < 100) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid amount (minimum $1)' }) };
  }

  const productName = `${clientName} - ${eventName || 'Event'} Deposit`;

  try {
    // Step 1: Create a one-time Price (which auto-creates a Product)
    const priceRes = await fetch('https://api.stripe.com/v1/prices', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'unit_amount': amountCents.toString(),
        'currency': 'usd',
        'product_data[name]': productName,
        'product_data[metadata][client]': clientName,
        'product_data[metadata][event]': eventName || '',
        'product_data[metadata][taskId]': taskId || '',
      }),
    });

    if (!priceRes.ok) {
      const err = await priceRes.text();
      console.error('Stripe price creation failed:', priceRes.status, err);
      return { statusCode: 502, headers, body: JSON.stringify({ message: 'Failed to create Stripe price', detail: err }) };
    }

    const price = await priceRes.json();

    // Step 2: Create a Payment Link using that Price
    const linkRes = await fetch('https://api.stripe.com/v1/payment_links', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'line_items[0][price]': price.id,
        'line_items[0][quantity]': '1',
        'payment_method_types[0]': 'card',
        'payment_method_types[1]': 'us_bank_account',
        'after_completion[type]': 'redirect',
        'after_completion[redirect][url]': 'https://ampersoundmediagroup.com/client-portal?paid=true',
        'metadata[client]': clientName,
        'metadata[event]': eventName || '',
        'metadata[taskId]': taskId || '',
      }),
    });

    if (!linkRes.ok) {
      const err = await linkRes.text();
      console.error('Stripe payment link creation failed:', linkRes.status, err);
      return { statusCode: 502, headers, body: JSON.stringify({ message: 'Failed to create payment link', detail: err }) };
    }

    const link = await linkRes.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        url: link.url,
        id: link.id,
        amount: amount,
        product: productName,
      }),
    };

  } catch (err) {
    console.error('Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Internal error', detail: err.message }) };
  }
};