const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const LIST_IDS = ['901418268145', '901418180552'];
const CF = { clientEmail:'3f38f15e-6aa4-4481-9365-d4a911d68195', eventName:'4299965c-96e2-430e-947a-ac16e9068aee', eventDate:'4006b42c-6597-49ea-bbb6-beb6bcc323b8', eventType:'f36884b1-eb6a-40b4-b1eb-ab75d0370ebc', venueName:'25f7eed6-37ba-49e7-918a-e6040531b58f', services:'605ff2b7-983f-43e1-8f78-fc684d140f80', totalFee:'a60f1fb7-4558-4cac-825c-abb9ea9a11e7', depositAmount:'f18252f2-13c7-4b04-a8d3-2b38dc096791', paymentLink:'959cae43-8c7a-43b4-b0ce-2513b311b227', paymentStatus:'96105ecf-6396-4fb1-90aa-93b37c9dfc48', agreementDoc:'b4a7de8c-d2d2-4f2b-b26e-8353d94f00b4' };
const headers = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS' };

// Static portal data for confirmed clients (fast path, no ClickUp API call needed)
const CLIENT_DATA = {
  'ryan.nelson.jrn@gmail.com': { eventName:'Katie & Ryan Wedding', eventDate:'2026-10-09', venue:'Utah State Capitol', services:'DJ + MC / Signature Celebration', totalFee:1912.50, deposit:956.25, portalUrl:'https://run.clickup.ai/90141325083/2d7a069d-dbe9-4d41-8343-aa6d4803c7ac/katie-ryan-agreement.html' },
  'kategeis@hotmail.com': { eventName:'Katie & Ryan Wedding', eventDate:'2026-10-09', venue:'Utah State Capitol', services:'DJ + MC / Signature Celebration', totalFee:1912.50, deposit:956.25, portalUrl:'https://run.clickup.ai/90141325083/2d7a069d-dbe9-4d41-8343-aa6d4803c7ac/katie-ryan-agreement.html' },
  'ashleyveenendaal23@gmail.com': { eventName:'Katie & Ryan Wedding', eventDate:'2026-10-09', venue:'Utah State Capitol', services:'DJ + MC / Signature Celebration', totalFee:1912.50, deposit:956.25, portalUrl:'https://run.clickup.ai/90141325083/2d7a069d-dbe9-4d41-8343-aa6d4803c7ac/katie-ryan-agreement.html' },
  'jesseradike1@gmail.com': { eventName:'Jesse & Zariah Wedding', eventDate:'2027-04-28', venue:'Grand Falls', services:'DJ + MC / Signature Celebration', totalFee:1912.50, deposit:956.25, portalUrl:'https://run.clickup.ai/90141325083/574ccfe8-f4f7-461e-9bc9-c8b9c1d49fe6/jesse-zariah-agreement.html' },
  'spinsbooknook@gmail.com': { eventName:'Aspen & Hyrum Wedding', eventDate:'2026-08-21', venue:'Lindon, Utah', services:'DJ / Essential Package', totalFee:722.50, deposit:361.25, portalUrl:'https://run.clickup.ai/90141325083/e1e2e40b-fa98-4935-8cb2-d00a62adb190/aspen-hyrum-agreement.html' },
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers, body:'' };
  if (event.httpMethod !== 'POST') return { statusCode:405, headers, body:JSON.stringify({message:'Method not allowed'}) };
  let body; try { body = JSON.parse(event.body); } catch { return { statusCode:400, headers, body:JSON.stringify({message:'Invalid request'}) }; }
  const email = (body.email||'').trim().toLowerCase();
  if (!email || !email.includes('@')) return { statusCode:400, headers, body:JSON.stringify({message:'Valid email required'}) };
  if (!CLICKUP_API_TOKEN) return { statusCode:500, headers, body:JSON.stringify({message:'Server configuration error'}) };

  try {
    // Fast path: known clients with confirmed bookings
    if (CLIENT_DATA[email]) {
      const d = CLIENT_DATA[email];
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          agreements: [{
            id: 'confirmed',
            eventName: d.eventName,
            eventDate: d.eventDate,
            eventType: 'Wedding',
            venue: d.venue,
            services: d.services,
            totalFee: d.totalFee,
            deposit: d.deposit,
            stage: 'agreement',
            status: 'signed',
            paymentStatus: 'paid',
            portalUrl: d.portalUrl,
            actions: '<a href="' + d.portalUrl + '">Open Client Portal</a>'
          }]
        })
      };
    }

    // Full lookup: search ClickUp lists
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

    // Match on Client Email field OR description contains the email
    const tasks = allTasks.filter(task => {
      const emailField = (task.custom_fields||[]).find(f => f.id === CF.clientEmail);
      if (emailField) {
        let fieldValue = '';
        if (typeof emailField.value === 'string') fieldValue = emailField.value;
        else if (emailField.value && typeof emailField.value === 'object') fieldValue = emailField.value.email || JSON.stringify(emailField.value);
        else if (emailField.value) fieldValue = String(emailField.value);
        if (fieldValue.toLowerCase() === email) return true;
      }
      // Fallback: check description
      if (task.description && task.description.toLowerCase().includes(email)) return true;
      return false;
    });

    if (tasks.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ message: 'No agreements found for this email.' }) };
    }

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

    const statusType = task.status ? (task.status.type || '') : '';
    const statusName = task.status ? (task.status.status || '').toLowerCase() : '';
    const isSigned = statusType === 'done' || statusType === 'closed' || statusName === 'signed' || statusName === 'closed' || statusName === 'paid';
    const isSent = statusName === 'sent' || statusName === 'proposal';

    let stage, status;
    if (isSigned) { stage = 'agreement'; status = 'signed'; }
    else if (isSent) { stage = 'proposal'; status = 'awaiting_signature'; }
    else { stage = 'proposal'; status = 'draft'; }

    const portalUrl = getField(CF.agreementDoc) || null;
    const paymentLink = getField(CF.paymentLink);

    const paymentStatusField = (task.custom_fields||[]).find(cf => cf.id === CF.paymentStatus);
    let paymentStatus = null;
    if (paymentStatusField && paymentStatusField.type_config && paymentStatusField.type_config.options && typeof paymentStatusField.value === 'number') {
      const opt = paymentStatusField.type_config.options.find(o => o.orderindex === paymentStatusField.value);
      if (opt) paymentStatus = opt.name;
    }
    const isPaid = paymentStatus === 'Payment Recieved';

    let actions = '';
    if (isSigned && portalUrl) {
      actions = '<a href="' + portalUrl + '">Open Client Portal</a>';
    } else if (isSigned) {
      actions = '<a href="/agreement/sign?token=' + task.id + '&view=true">View Agreement</a>';
    } else if (!isPaid && paymentLink) {
      actions = '<a href="' + paymentLink + '" class="pay-action">Pay Deposit</a>';
    } else {
      const proposalLinkField = (task.custom_fields||[]).find(cf => cf.id === '41aa0747-8956-404a-8460-1ddfb0d5e913');
      const proposalLink = proposalLinkField && typeof proposalLinkField.value === 'string' ? proposalLinkField.value : null;
      if (proposalLink) actions = '<a href="' + proposalLink + '">View Proposal</a>';
      else actions = '<a href="/agreement/sign?token=' + task.id + '">View</a>';
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
      portalUrl,
      actions,
    };
  });
}
