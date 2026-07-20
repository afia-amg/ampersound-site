const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const LIST_ID = '4027438415107101193';
const SITE_URL = process.env.SITE_URL || 'https://ampersoundmediagroup.com';
const CF = { clientEmail:'3f38f15e-6aa4-4481-9365-d4a911d68195', eventName:'4299965c-96e2-430e-947a-ac16e9068aee', eventDate:'4006b42c-6597-49ea-bbb6-beb6bcc323b8', eventType:'f36884b1-eb6a-40b4-b1eb-ab75d0370ebc', venueName:'25f7eed6-37ba-49e7-918a-e6040531b58f', services:'605ff2b7-983f-43e1-8f78-fc684d140f80', totalFee:'a60f1fb7-4558-4cac-825c-abb9ea9a11e7', depositAmount:'f18252f2-13c7-4b04-a8d3-2b38dc096791' };
const headers = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers, body:'' };
  if (event.httpMethod !== 'POST') return { statusCode:405, headers, body:JSON.stringify({message:'Method not allowed'}) };
  let body; try { body = JSON.parse(event.body); } catch { return { statusCode:400, headers, body:JSON.stringify({message:'Invalid request'}) }; }
  const email = (body.email||'').trim().toLowerCase();
  if (!email || !email.includes('@')) return { statusCode:400, headers, body:JSON.stringify({message:'Valid email required'}) };
  if (!CLICKUP_API_TOKEN) return { statusCode:500, headers, body:JSON.stringify({message:'Server configuration error'}) };
  try {
    const url = `https://api.clickup.com/api/v2/list/${LIST_ID}/task?include_closed=true&subtasks=false`;
    const res = await fetch(url, { headers:{'Authorization':CLICKUP_API_TOKEN} });
    if (!res.ok) return { statusCode:502, headers, body:JSON.stringify({message:'Unable to retrieve agreements'}) };
    const data = await res.json();
    const tasks = (data.tasks||[]).filter(task => { const ef = (task.custom_fields||[]).find(f=>f.id===CF.clientEmail); return ef && ef.value && ef.value.toLowerCase() === email; });
    return { statusCode:200, headers, body:JSON.stringify({agreements:formatAgreements(tasks)}) };
  } catch(err) { console.error('Lookup error:', err); return { statusCode:500, headers, body:JSON.stringify({message:'Internal error'}) }; }
};

function formatAgreements(tasks) {
  return tasks.map(task => {
    const getField = (id) => { const f = (task.custom_fields||[]).find(cf=>cf.id===id); if (!f) return null; if (f.type==='drop_down' && f.type_config && f.type_config.options) { const opt = f.type_config.options.find(o=>o.orderindex===f.value); return opt?opt.name:(f.value_label||null); } if (f.type==='labels' && f.value && Array.isArray(f.value)) return f.value.map(v=>v.label||v).join(', '); if (f.type==='date' && f.value) return new Date(Number(f.value)).toISOString().split('T')[0]; if (f.type==='currency' && f.value!==undefined && f.value!==null) return f.value; return f.value||f.value_label||null; };
    const isSigned = task.status && (task.status.status||'').toLowerCase() !== 'to do';
    const status = isSigned ? 'signed' : 'pending';
    let actions = '';
    if (status === 'pending') actions = `<a href="${SITE_URL}/agreement/sign?token=${task.id}">Sign Agreement</a>`;
    actions += `<a href="${SITE_URL}/agreement/sign?token=${task.id}&view=true">View Agreement</a>`;
    return { id:task.id, eventName:getField(CF.eventName)||task.name.split('|')[1]?.trim()||task.name, eventDate:getField(CF.eventDate)||'TBD', eventType:getField(CF.eventType), venue:getField(CF.venueName), services:getField(CF.services), totalFee:getField(CF.totalFee), deposit:getField(CF.depositAmount), status, actions };
  });
}