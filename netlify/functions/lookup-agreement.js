const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const LIST_IDS = ['901418268145', '901418180552']; // Agreements list + Proposals Sent list
const CF = { clientEmail:'3f38f15e-6aa4-4481-9365-d4a911d68195', eventName:'4299965c-96e2-430e-947a-ac16e9068aee', eventDate:'4006b42c-6597-49ea-bbb6-beb6bcc323b8', eventType:'f36884b1-eb6a-40b4-b1eb-ab75d0370ebc', venueName:'25f7eed6-37ba-49e7-918a-e6040531b58f', services:'605ff2b7-983f-43e1-8f78-fc684d140f80', totalFee:'a60f1fb7-4558-4cac-825c-abb9ea9a11e7', depositAmount:'f18252f2-13c7-4b04-a8d3-2b38dc096791', paymentLink:'959cae43-8c7a-43b4-b0ce-2513b311b227', paymentStatus:'96105ecf-6396-4fb1-90aa-93b37c9dfc48', agreementDoc:'b4a7de8c-d2d2-4f2b-b26e-8353d94f00b4' };
const headers = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS' };

// Static portal map for clients who have paid (fast path)
const CLIENT_PORTALS = {
  'ryan.nelson.jrn@gmail.com': 'https://run.clickup.ai/90141325083/2d7a069d-dbe9-4d41-8343-aa6d4803c7ac/katie-ryan-agreement.html',
  'kategeis@hotmail.com': 'https://run.clickup.ai/90141325083/2d7a069d-dbe9-4d41-8343-aa6d4803c7ac/katie-ryan-agreement.html',
  'ashleyveenendaal23@gmail.com': 'https://run.clickup.ai/90141325083/2d7a069d-dbe9-4d41-8343-aa6d4803c7ac/katie-ryan-agreement.html',
  'jesseradike1@gmail.com': 'https://run.clickup.ai/90141325083/574ccfe8-f4f7-461e-9bc9-c8b9c1d49fe6/jesse-zariah-agreement.html',
  'spinsbooknook@gmail.com': 'https://run.clickup.ai/90141325083/e1e2e40b-fa98-4935-8cb2-d00a62adb190/aspen-hyrum-agreement.html',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers, body:'' };
  if (event.httpMethod !== 'POST') return { statusCode:405, headers, body:JSON.stringify({message:'Method not allowed'}) };
  let body; try { body = JSON.parse(event.body); } catch { return { statusCode:400, headers, body:JSON.stringify({message:'Invalid request'}) }; }
  const email = (body.email||'').trim().toLowerCase();
  if (!email || !email.includes('@')) return { statusCode:400, headers, body:JSON.stringify({message:'Valid email required'}) };
  if (!CLICKUP_API_TOKEN) return { statusCode:500, headers, body:JSON.stringify({message:'Server configuration error'}) };

  try {
    // Fast path: check static portal map first
    if (CLIENT_PORTALS[email]) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          agreements: [{
            portalUrl: CLIENT_PORTALS[email],
            stage: 'agreement',
            status: 'signed',
            paymentStatus: 'paid',
          }],
          portalRedirect: CLIENT_PORTALS[email]
        })
      };
    }

    // Search across multiple lists
    const allTasks = [];
    for (const listId of LIST_IDS) {
      const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task?archived=false&include_closed=true&subtasks=false&page=0`, {
        method: 'GET',
        headers: { 'Authorization': CLICKUP_API_TOKEN, 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.tasks) allTasks.push(...data.tasks);
      }
    }

    const tasks = allTasks.filter(task => {
      // Match on Client Email field
      const emailField = (task.custom_fields||[]).find(f => f.id === CF.clientEmail);
      if (emailField) {
        let fieldValue = '';
        if (typeof emailField.value === 'string') fieldValue = emailField.value;
        else if (emailField.value && typeof emailField.value === 'object') fieldValue = emailField.value.email || JSON.stringify(emailField.value);
        else if (emailField.value) fieldValue = String(emailField.value);
        if (fieldValue.toLowerCase() === email) return true;
      }
      // Fallback: check description for email mention
      if (task.description && task.description.toLowerCase().includes(email)) return true;
      return false;
    });

    if (tasks.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ message: 'No agreements found for this email.' }) };
    }

    const formatted = formatAgreements(tasks);

    // If the first agreement has a portal URL, include it as a redirect hint
    const portalRedirect = formatted[0] && formatted[0].portalUrl ? formatted[0].portalUrl : null;

    return { statusCode:200, headers, body:JSON.stringify({ agreements: formatted, portalRedirect }) };
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
    const isSigned = statusType === 'done' || statusType === 'closed' || statusName === 'signed' || statusName === 'closed' || statusName === 'paid';
    const isSent = statusName === 'sent' || statusName === 'proposal';

    let stage, status;
    if (isSigned) { stage = 'agreement'; status = 'signed'; }
    else if (isSent) { stage = 'proposal'; status = 'awaiting_signature'; }
    else { stage = 'proposal'; status = 'draft'; }

    // Get portal/agreement document URL
    const portalUrl = getField(CF.agreementDoc) || null;

    const proposalLinkField = (task.custom_fields||[]).find(cf => cf.id === '41aa0747-8956-404a-8460-1ddfb0d5e913');
    const proposalLink = proposalLinkField && typeof proposalLinkField.value === 'string' ? proposalLinkField.value : null;

    let actions = '';
    if (stage === 'proposal') {
      if (proposalLink) {
        actions += `<a href="${proposalLink}">View Quote</a>`;
        actions += `<a href="${proposalLink.replace('quote.html','sign.html')}">Sign Agreement</a>`;
      } else {
        actions += `<a href="/proposal?token=${task.id}">View Proposal</a>`;
        if (isSent) actions += `<a href="/agreement/sign?token=${task.id}">Sign Agreement</a>`;
      }
    } else {
      if (portalUrl) {
        actions += `<a href="${portalUrl}">Open Client Portal</a>`;
      } else {
        actions += `<a href="/agreement/sign?token=${task.id}&view=true">View Agreement</a>`;
      }
      if (!isPaid && paymentLink) {
        actions += `<a href="${paymentLink}" class="pay-action">Pay Deposit</a>`;
      }
    }

    return {
      id: task.id,
      eventName: getField(CF.eventName) || task.name,
      eventDate: getField(CF.eventDate) || 'TBD',
      eventType: getField(CF.eventType),
      venue: getField(CF.venueName),
      services: getField(CF.services),
      totalFee: getField(CF.totalFee),
      deposit: getField(CF.depositAmount),
      stage,
      status,
      paymentStatus: isPaid ? 'paid' : (paymentLink ? 'unpaid' : 'no_link'),
      paymentLink,
      portalUrl,
      actions,
    };
  });
}
