const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const LIST_IDS = ['901418268145', '901418180552'];
const CF = { clientEmail:'3f38f15e-6aa4-4481-9365-d4a911d68195', eventName:'4299965c-96e2-430e-947a-ac16e9068aee', eventDate:'4006b42c-6597-49ea-bbb6-beb6bcc323b8', eventType:'f36884b1-eb6a-40b4-b1eb-ab75d0370ebc', venueName:'25f7eed6-37ba-49e7-918a-e6040531b58f', services:'605ff2b7-983f-43e1-8f78-fc684d140f80', totalFee:'a60f1fb7-4558-4cac-825c-abb9ea9a11e7', depositAmount:'f18252f2-13c7-4b04-a8d3-2b38dc096791', paymentLink:'959cae43-8c7a-43b4-b0ce-2513b311b227', paymentStatus:'96105ecf-6396-4fb1-90aa-93b37c9dfc48', agreementDoc:'b4a7de8c-d2d2-4f2b-b26e-8353d94f00b4' };
const headers = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS' };

const CLIENT_PORTALS = {
  'ryan.nelson.jrn@gmail.com': {
    eventName: 'Katie & Ryan Wedding',
    eventDate: '2026-10-09',
    eventType: 'Wedding',
    venue: 'Utah State Capitol',
    services: 'DJ / Sound Direction, MC / Event Hosting, Audio / AV Production',
    totalFee: 1912.50,
    deposit: 956.25,
    stage: 'agreement',
    status: 'signed',
    paymentStatus: 'paid',
    portalUrl: 'https://run.clickup.ai/90141325083/f17229a3-766e-46ec-8fd6-8a324860110b/katie-ryan-agreement.html',
  },
  'jesseradike1@gmail.com': {
    eventName: 'Jesse & Zariah Wedding',
    eventDate: '2027-04-28',
    eventType: 'Wedding',
    venue: 'Grand Falls',
    services: 'DJ / Sound Direction, MC / Event Hosting',
    totalFee: 1912.50,
    deposit: 478.13,
    stage: 'agreement',
    status: 'signed',
    paymentStatus: 'paid',
    portalUrl: 'https://run.clickup.ai/90141325083/a5502997-392f-46d7-b56c-19e35e7725df/jesse-zariah-agreement.html',
  },
  'liffcakeparties@gmail.com': {
    eventName: 'Angelica & Nathan Wedding',
    eventDate: '2026-09-05',
    eventType: 'Wedding',
    venue: 'Backyard',
    services: 'DJ / Sound Direction, MC / Event Hosting',
    totalFee: 900,
    deposit: 900,
    stage: 'agreement',
    status: 'signed',
    paymentStatus: 'paid',
    portalUrl: 'https://run.clickup.ai/90141325083/c68cf5b1-e395-410e-8975-af6807327546/angelica-nathan-agreement.html',
  },
};

CLIENT_PORTALS['kategeis@hotmail.com'] = CLIENT_PORTALS['ryan.nelson.jrn@gmail.com'];
CLIENT_PORTALS['ashleyveenendaal23@gmail.com'] = CLIENT_PORTALS['ryan.nelson.jrn@gmail.com'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers, body:'' };
  if (event.httpMethod !== 'POST') return { statusCode:405, headers, body:JSON.stringify({message:'Method not allowed'}) };
  let body; try { body = JSON.parse(event.body); } catch { return { statusCode:400, headers, body:JSON.stringify({message:'Invalid request'}) }; }
  const email = (body.email||'').trim().toLowerCase();
  if (!email || !email.includes('@')) return { statusCode:400, headers, body:JSON.stringify({message:'Valid email required'}) };
  if (!CLICKUP_API_TOKEN) return { statusCode:500, headers, body:JSON.stringify({message:'Server configuration error'}) };

  try {
    const staticEntry = CLIENT_PORTALS[email];
    if (staticEntry) {
      let actions = '';
      if (staticEntry.portalUrl) {
        actions = '<a href="' + staticEntry.portalUrl + '">Open Client Portal</a>';
      }
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          agreements: [{
            id: 'static-' + email.split('@')[0],
            eventName: staticEntry.eventName,
            eventDate: staticEntry.eventDate,
            eventType: staticEntry.eventType,
            venue: staticEntry.venue,
            services: staticEntry.services,
            totalFee: staticEntry.totalFee,
            deposit: staticEntry.deposit,
            stage: staticEntry.stage,
            status: staticEntry.status,
            paymentStatus: staticEntry.paymentStatus,
            portalUrl: staticEntry.portalUrl,
            actions: actions,
          }]
        })
      };
    }

    const allTasks = [];
    for (const listId of LIST_IDS) {
      const res = await fetch('https://api.clickup.com/api/v2/list/' + listId + '/task?archived=false&include_closed=true&subtasks=false&page=0', {
        method: 'GET',
        headers: { 'Authorization': CLICKUP_API_TOKEN, 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.tasks) allTasks.push(...data.tasks);
      }
    }

    const tasks = allTasks.filter(function(task) {
      var emailField = (task.custom_fields||[]).find(function(f) { return f.id === CF.clientEmail; });
      if (emailField) {
        var fieldValue = '';
        if (typeof emailField.value === 'string') fieldValue = emailField.value;
        else if (emailField.value && typeof emailField.value === 'object') fieldValue = emailField.value.email || '';
        else if (emailField.value) fieldValue = String(emailField.value);
        if (fieldValue.toLowerCase() === email) return true;
      }
      if (task.description && task.description.toLowerCase().indexOf(email) !== -1) return true;
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
  return tasks.map(function(task) {
    var getField = function(id) {
      var f = (task.custom_fields||[]).find(function(cf) { return cf.id === id; });
      if (!f || f.value === null || f.value === undefined) return null;
      if (f.type === 'drop_down' && f.type_config && f.type_config.options && typeof f.value === 'number') {
        var opt = f.type_config.options.find(function(o) { return o.orderindex === f.value; });
        return opt ? opt.name : null;
      }
      if (f.type === 'labels' && Array.isArray(f.value)) return f.value.map(function(v) { return typeof v === 'string' ? v : (v.label || v.name || ''); }).join(', ');
      if (f.type === 'date' && f.value) { try { return new Date(Number(f.value)).toISOString().split('T')[0]; } catch(e) { return null; } }
      if (f.type === 'currency') { var n = typeof f.value === 'number' ? f.value : parseFloat(f.value); return isNaN(n) ? null : n; }
      if (typeof f.value === 'string') return f.value;
      if (typeof f.value === 'number') return f.value;
      return null;
    };

    var statusType = task.status ? (task.status.type || '') : '';
    var statusName = task.status ? (task.status.status || '').toLowerCase() : '';
    var isSigned = statusType === 'done' || statusType === 'closed' || statusName === 'signed' || statusName === 'closed' || statusName === 'paid';
    var isSent = statusName === 'sent' || statusName === 'proposal';

    var stage, status;
    if (isSigned) { stage = 'agreement'; status = 'signed'; }
    else if (isSent) { stage = 'proposal'; status = 'awaiting_signature'; }
    else { stage = 'proposal'; status = 'draft'; }

    var portalUrl = getField(CF.agreementDoc) || null;
    var actions = '';
    if (portalUrl) {
      actions = '<a href="' + portalUrl + '">Open Client Portal</a>';
    } else {
      actions = '<a href="/agreement/sign?token=' + task.id + '&view=true">View Agreement</a>';
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
      stage: stage,
      status: status,
      paymentStatus: isSigned ? 'paid' : 'unpaid',
      portalUrl: portalUrl,
      actions: actions,
    };
  });
}
