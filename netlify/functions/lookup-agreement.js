const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const LIST_ID = '901418268145';
const CF = { clientEmail:'3f38f15e-6aa4-4481-9365-d4a911d68195', eventName:'4299965c-96e2-430e-947a-ac16e9068aee', eventDate:'4006b42c-6597-49ea-bbb6-beb6bcc323b8', eventType:'f36884b1-eb6a-40b4-b1eb-ab75d0370ebc', venueName:'25f7eed6-37ba-49e7-918a-e6040531b58f', services:'605ff2b7-983f-43e1-8f78-fc684d140f80', totalFee:'a60f1fb7-4558-4cac-825c-abb9ea9a11e7', depositAmount:'f18252f2-13c7-4b04-a8d3-2b38dc096791', paymentLink:'959cae43-8c7a-43b4-b0ce-2513b311b227', paymentStatus:'96105ecf-6396-4fb1-90aa-93b37c9dfc48' };
const headers = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers, body:'' };
  if (event.httpMethod !== 'POST') return { statusCode:405, headers, body:JSON.stringify({message:'Method not allowed'}) };
  let body; try { body = JSON.parse(event.body); } catch { return { statusCode:400, headers, body:JSON.stringify({message:'Invalid request'}) }; }
  const email = (body.email||'').trim().toLowerCase();
  if (!email || !email.includes('@')) return { statusCode:400, headers, body:JSON.stringify({message:'Valid email required'}) };
  if (!CLICKUP_API_TOKEN) return { statusCode:500, headers, body:JSON.stringify({message:'Server configuration error'}) };

  try {
    const res = await fetch(`https://api.clickup.com/api/v2/list/${LIST_ID}/task?archived=false&include_closed=true&subtasks=false&page=0`, {
      method: 'GET',
      headers: { 'Authorization': CLICKUP_API_TOKEN, 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('ClickUp API error:', res.status, errBody);
      return { statusCode:502, headers, body:JSON.stringify({message:'Unable to retrieve agreements'}) };
    }

    const data = await res.json();

    const tasks = (data.tasks||[]).filter(task => {
      const emailField = (task.custom_fields||[]).find(f => f.id === CF.clientEmail);
      if (!emailField) return false;
      let fieldValue = '';
      if (typeof emailField.value === 'string') fieldValue = emailField.value;
      else if (emailField.value && typeof emailField.value === 'object') fieldValue = emailField.value.email || JSON.stringify(emailField.value);
      else if (emailField.value) fieldValue = String(emailField.value);
      return fieldValue.toLowerCase() === email;
    });

    return { statusCode:200, headers, body:JSON.stringify({agreements:formatAgreements(tasks)}) };
  } catch(err) {
    console.error('Lookup error:', err.message);
    return { statusCode:500, headers, body:JSON.stringify({message:'Internal error'}) };
  }
};

function formatAgreements(tasks) {
  return tasks.map(task => {
    const getField = (id) => {
      const f = (task.custom_fields||[]).find(cf => cf.id === id);
      if (!f || f.value === null || f.value === undefined) return null;
      if (f.type === 'drop_down' && f.type_config && f.type_config.options && typeof f.value === 'number') {
        const opt = f.type_config.options.find(o => o.orderindex === f.value);
        return opt ? opt.name : null;
      }
      if (f.type === 'labels' && Array.isArray(f.value)) return f.value.map(v => typeof v === 'string' ? v : (v.label || v.name || '')).join(', ');
      if (f.type === 'date' && f.value) { try { return new Date(Number(f.value)).toISOString().split('T')[0]; } catch { return null; } }
      if (f.type === 'currency') { const n = typeof f.value === 'number' ? f.value : parseFloat(f.value); return isNaN(n) ? null : n; }
      if (typeof f.value === 'string') return f.value;
      if (typeof f.value === 'number') return f.value;
      return null;
    };

    // Get payment status
    const paymentStatusField = (task.custom_fields||[]).find(cf => cf.id === CF.paymentStatus);
    let paymentStatus = null;
    if (paymentStatusField && paymentStatusField.type_config && paymentStatusField.type_config.options && typeof paymentStatusField.value === 'number') {
      const opt = paymentStatusField.type_config.options.find(o => o.orderindex === paymentStatusField.value);
      if (opt) paymentStatus = opt.name;
    }

    const isPaid = paymentStatus === 'Payment Recieved';
    const paymentLink = getField(CF.paymentLink);

    const statusType = task.status ? (task.status.type || '') : '';
    const statusName = task.status ? (task.status.status || '').toLowerCase() : '';
    const isSigned = statusType === 'done' || statusType === 'closed' || statusName === 'signed' || statusName === 'closed';
    const status = isSigned ? 'signed' : 'pending';

    // Build actions based on state
    let actions = '';
    if (status === 'pending') {
      actions += `<a href="/agreement/sign?token=${task.id}">Sign Agreement</a>`;
    }
    if (isSigned && !isPaid && paymentLink) {
      actions += `<a href="${paymentLink}" class="pay-action">Pay Deposit</a>`;
    }
    actions += `<a href="/agreement/sign?token=${task.id}&view=true">View Agreement</a>`;

    return {
      id: task.id,
      eventName: getField(CF.eventName) || task.name,
      eventDate: getField(CF.eventDate) || 'TBD',
      eventType: getField(CF.eventType),
      venue: getField(CF.venueName),
      services: getField(CF.services),
      totalFee: getField(CF.totalFee),
      deposit: getField(CF.depositAmount),
      status,
      paymentStatus: isPaid ? 'paid' : (paymentLink ? 'unpaid' : 'no_link'),
      paymentLink,
      actions,
    };
  });
}