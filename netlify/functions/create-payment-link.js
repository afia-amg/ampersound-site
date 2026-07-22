const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SITE_URL = process.env.SITE_URL || 'https://ampersoundmediagroup.com';

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

  const { clientName, eventName, eventDate, venue, services, amount, balance, taskId } = data;

  if (!amount || !clientName) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'clientName and amount required' }) };
  }

  const amountCents = Math.round(Number(amount) * 100);
  if (isNaN(amountCents) || amountCents < 100) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid amount (minimum $1)' }) };
  }

  const productName = `${clientName} - ${eventName || 'Event'} Deposit`;

  // Build redirect URL with event details for the confirmation page
  const redirectParams = new URLSearchParams({
    event: eventName || '',
    date: eventDate || '',
    venue: venue || '',
    services: services || '',
    paid: `$${Number(amount).toLocaleString()}`,
    balance: balance ? `$${Number(balance).toLocaleString()}` : '$0',
  });
  const redirectUrl = `${SITE_URL}/booking-confirmed?${redirectParams.toString()}`;

  try {
    // Create Price (auto-creates Product)
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

    // Create Payment Link
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
        'after_completion[redirect][url]': redirectUrl,
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