const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const LIST_ID = '901418268145';
const CHAT_CHANNEL_ID = process.env.CLICKUP_CHAT_CHANNEL_ID;
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const FROM_EMAIL = process.env.FROM_EMAIL || 'contact@ampersoundmediagroup.com';
const SITE_URL = process.env.SITE_URL || 'https://ampersoundmediagroup.com';

const FIELDS = { clientName:'01b694ba-6da6-4e4c-a3d3-af4b96a7a0c5', organization:'aeeee479-3136-47c0-b10e-a2512f92a065', clientEmail:'3f38f15e-6aa4-4481-9365-d4a911d68195', clientPhone:'c76029af-56b9-4079-aef8-7af4c6d87a1e', mailingAddress:'fdba9ebc-a9da-4273-941f-1f61a7492c47', eventName:'4299965c-96e2-430e-947a-ac16e9068aee', eventDate:'4006b42c-6597-49ea-bbb6-beb6bcc323b8', eventType:'f36884b1-eb6a-40b4-b1eb-ab75d0370ebc', startTime:'c694927d-9f80-45bc-a99f-5ba5b2b1929c', endTime:'ac7880e0-051f-4208-a7b5-819243839076', venueName:'25f7eed6-37ba-49e7-918a-e6040531b58f', venueAddress:'bde68d62-d513-4406-b65b-23923f723c37', guestCount:'a0aae2d5-a1b1-4a81-aaa0-fdbbd0294d48', indoorOutdoor:'087e8d6a-f58e-4fff-8589-328bab2e2a36', eventNotes:'c0d6e105-1e95-4553-b269-b4af4af28826', serviceNotes:'cf2c16a3-ae59-4246-88b1-8783e0267458', services:'605ff2b7-983f-43e1-8f78-fc684d140f80', totalFee:'a60f1fb7-4558-4cac-825c-abb9ea9a11e7', depositAmount:'f18252f2-13c7-4b04-a8d3-2b38dc096791', balanceDue:'61d4c0c8-2f98-46ba-9c6e-fec7ca31981c', depositDueDate:'66f05f1f-175f-4227-ad48-544f22923d3b', balanceDueDate:'c74c04b1-9999-48b1-a885-819166b664ad', bookingType:'e70b1c01-e9f9-4608-8742-39b933395cae', paymentMethod:'81020cc8-bdad-4008-9507-db8c8a520b87', agreementDoc:'b4a7de8c-d2d2-4f2b-b26e-8353d94f00b4' };

const EVENT_TYPE_OPTIONS = { 'Wedding':'c88b6010-905c-4c74-87c5-d8fdae52209c','Corporate Event':'a58d4eda-03a5-4fc7-ab18-048b16320c25','Convention / Conference':'63ecbd18-04a0-48ad-8f4e-68c8b2a8f254','Private Party':'70780adc-17c1-4add-b1bc-8f5a926b9a38','Community Event':'03de6fb0-6283-427d-a5b7-0fdf2df91705','Concert / Show':'e8fdc1b9-453c-45f0-a45a-2dea0070f9f6','Other':'f02ab28b-21e9-44c8-b6bf-21c4babed292' };
const INDOOR_OUTDOOR_OPTIONS = { 'Indoor':'c5799b8d-2dfd-4fa3-822e-9259a556824b','Outdoor':'d7f93389-49df-4715-afc5-7b1d68212145','Both':'27461c5b-fabe-4bd4-ba76-86db2a46db0b' };
const BOOKING_TYPE_OPTIONS = { 'Standard Booking (14+ days before event)':'6e109121-f127-4501-9941-c1da6029e989','Late Booking (within 14 days of event)':'2acab904-f394-4f5d-bc9a-808ba6f40557' };
const PAYMENT_METHOD_OPTIONS = { 'Credit / Debit Card':'1b7b92ed-e90b-4001-a95e-743d9375e8b3','ACH / Bank Transfer':'5d5394c2-b3eb-47cf-a50c-20a3e412c265','Zelle':'2f41b8ab-6687-420c-a9be-4e6854719333','Check':'51789fdb-0c99-452c-80c0-f8e3452b5379','Other':'01d9164b-f360-44a2-afb2-ea2c00441fd2' };
const SERVICES_OPTIONS = { 'DJ / Sound Direction':'d09d1ebc-e33f-4fe5-80a5-5cd985a9926c','MC / Event Hosting':'13205b3f-8122-4df9-9776-8b89114915b2','Moderation':'41fc8fe2-043f-4bcd-b8f5-ef4d7819cf7b','Spoken Word':'d0035ae8-d097-47b2-bc18-3274d789093e','Speaker / Keynote':'072d3d89-20bd-46c5-b309-c8417b3c1944','Audio / AV Production':'d4a63bb3-5d0a-4c79-916c-81426a95d682','Custom Playlist Curation':'09a8604f-584a-4a13-89fa-f55cf97a2221','Equipment Rental':'6e74f9c6-6740-4786-b389-93f9b71b922f' };

const headers = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS' };

async function getGmailAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET, refresh_token: GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  if (!res.ok) throw new Error('Failed to refresh Gmail token');
  return (await res.json()).access_token;
}

async function sendClientEmail(data) {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !data.clientEmail) return;
  const fee = data.totalFee ? `$${Number(data.totalFee).toLocaleString()}` : 'See agreement';
  const deposit = data.depositAmount ? `$${Number(data.depositAmount).toLocaleString()}` : 'See agreement';
  const services = (data.services || []).join(', ') || 'See agreement';
  const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#0f1114;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1114;padding:40px 20px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#181c21;border:1px solid rgba(201,169,110,0.15);border-radius:12px;overflow:hidden;"><tr><td style="padding:32px 40px 24px;border-bottom:2px solid #c9a96e;"><img src="https://lh3.googleusercontent.com/d/10P4ITtp20uk0Cn_xFypAbL1nf1bv48xU" alt="Ampersound Media Group" height="36" style="display:block;"></td></tr><tr><td style="padding:32px 40px;"><h1 style="font-size:22px;color:#f0ebe4;margin:0 0 8px;font-weight:700;">Agreement Confirmed</h1><p style="color:rgba(240,235,228,0.65);font-size:15px;line-height:1.6;margin:0 0 24px;">Hi ${data.clientName},<br><br>Thank you for signing your service agreement with Ampersound Media Group. This email confirms your booking.</p><table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td style="padding:12px 16px;background:#141719;border-radius:8px 8px 0 0;border-bottom:1px solid rgba(201,169,110,0.1);"><span style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#c9a96e;font-weight:600;">Event</span><br><span style="color:#f0ebe4;font-size:14px;">${data.eventName} - ${data.eventDate}</span></td></tr><tr><td style="padding:12px 16px;background:#141719;border-bottom:1px solid rgba(201,169,110,0.1);"><span style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#c9a96e;font-weight:600;">Venue</span><br><span style="color:#f0ebe4;font-size:14px;">${data.venueName || ''}${data.venueAddress ? ', ' + data.venueAddress : ''}</span></td></tr><tr><td style="padding:12px 16px;background:#141719;border-bottom:1px solid rgba(201,169,110,0.1);"><span style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#c9a96e;font-weight:600;">Services</span><br><span style="color:#f0ebe4;font-size:14px;">${services}</span></td></tr><tr><td style="padding:12px 16px;background:#141719;border-bottom:1px solid rgba(201,169,110,0.1);"><span style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#c9a96e;font-weight:600;">Total Fee</span><br><span style="color:#f0ebe4;font-size:14px;font-weight:600;">${fee}</span></td></tr><tr><td style="padding:12px 16px;background:#141719;border-bottom:1px solid rgba(201,169,110,0.1);"><span style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#c9a96e;font-weight:600;">Deposit Due</span><br><span style="color:#f0ebe4;font-size:14px;">${deposit}${data.depositDueDate ? ' by ' + data.depositDueDate : ' upon signing'}</span></td></tr><tr><td style="padding:12px 16px;background:#141719;border-radius:0 0 8px 8px;"><span style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#c9a96e;font-weight:600;">Signed By</span><br><span style="color:#f0ebe4;font-size:14px;">${data.signedName} on ${data.signedDate}</span></td></tr></table><p style="color:rgba(240,235,228,0.65);font-size:14px;line-height:1.6;margin:0 0 24px;"><strong style="color:#f0ebe4;">What happens next:</strong><br>1. Submit your deposit to secure the date<br>2. We'll reach out to schedule a planning consultation<br>3. Final timeline and details are due 72 hours before the event</p><a href="${SITE_URL}/client-portal" style="display:inline-block;padding:12px 24px;background:#c9a96e;color:#0f1114;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;margin-top:8px;">View My Agreement</a></td></tr><tr><td style="padding:24px 40px;border-top:1px solid rgba(201,169,110,0.1);text-align:center;"><p style="color:rgba(240,235,228,0.35);font-size:12px;margin:0;line-height:1.5;">Ampersound Media Group &bull; North Salt Lake, Utah<br>contact@ampersoundmediagroup.com<br><span style="color:#c9a96e;">Sound. Presence. Atmosphere.</span></p></td></tr></table></td></tr></table></body></html>`;
  const subject = `Your Service Agreement with Ampersound Media Group - ${data.eventName}`;
  const emailLines = [`From: Ampersound Media Group <${FROM_EMAIL}>`,`To: ${data.clientName} <${data.clientEmail}>`,`Subject: ${subject}`,`MIME-Version: 1.0`,`Content-Type: text/html; charset=UTF-8`,``,htmlBody];
  const raw = Buffer.from(emailLines.join('\r\n')).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  try {
    const accessToken = await getGmailAccessToken();
    const emailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${accessToken}`}, body:JSON.stringify({raw}) });
    if (!emailRes.ok) console.error('Gmail API error:', emailRes.status, await emailRes.text());
    else console.log('Email sent successfully to', data.clientEmail);
  } catch(e) { console.error('Email error:', e.message); }
}

async function notifyChat(data, taskUrl) {
  if (!CHAT_CHANNEL_ID) return;
  const msg = `\ud83d\udcdd **New Agreement Signed**\n\n**Client:** ${data.clientName}${data.organization?' ('+data.organization+')':''}\n**Event:** ${data.eventName} - ${data.eventDate}\n**Type:** ${data.eventType || 'N/A'}\n**Venue:** ${data.venueName || 'N/A'}\n**Services:** ${(data.services||[]).join(', ')||'Not specified'}\n**Total Fee:** ${data.totalFee?'$'+Number(data.totalFee).toLocaleString():'TBD'}\n\n[View Agreement Task](${taskUrl})`;
  try { await fetch(`https://api.clickup.com/api/v3/chat/${CHAT_CHANNEL_ID}/message`, { method:'POST', headers:{'Content-Type':'application/json','Authorization':CLICKUP_API_TOKEN}, body:JSON.stringify({content:msg}) }); } catch(e) { console.error('Chat error:', e.message); }
}

function buildCustomFields(data) {
  const customFields = [];
  const textMap = [['clientName',data.clientName],['organization',data.organization],['mailingAddress',data.mailingAddress],['eventName',data.eventName],['startTime',data.startTime],['endTime',data.endTime],['venueName',data.venueName],['venueAddress',data.venueAddress]];
  for (const [k,v] of textMap) { if (v) customFields.push({id:FIELDS[k],value:v}); }
  if (data.eventNotes) customFields.push({id:FIELDS.eventNotes,value:data.eventNotes});
  if (data.serviceNotes) customFields.push({id:FIELDS.serviceNotes,value:data.serviceNotes});
  if (data.clientEmail) customFields.push({id:FIELDS.clientEmail,value:data.clientEmail});
  if (data.clientPhone) {
    let ph = data.clientPhone;
    if (ph && !ph.startsWith('+')) ph = '+1' + ph.replace(/\D/g,'');
    customFields.push({id:FIELDS.clientPhone,value:ph});
  }
  if (data.guestCount) customFields.push({id:FIELDS.guestCount,value:Number(data.guestCount)});
  if (data.totalFee) customFields.push({id:FIELDS.totalFee,value:Number(data.totalFee)});
  if (data.depositAmount) customFields.push({id:FIELDS.depositAmount,value:Number(data.depositAmount)});
  if (data.balanceDue) customFields.push({id:FIELDS.balanceDue,value:Number(data.balanceDue)});
  const toMs = d => d ? new Date(d+'T00:00:00').getTime() : null;
  if (data.eventDate) customFields.push({id:FIELDS.eventDate,value:toMs(data.eventDate)});
  if (data.depositDueDate) customFields.push({id:FIELDS.depositDueDate,value:toMs(data.depositDueDate)});
  if (data.balanceDueDate) customFields.push({id:FIELDS.balanceDueDate,value:toMs(data.balanceDueDate)});
  if (data.eventType && EVENT_TYPE_OPTIONS[data.eventType]) customFields.push({id:FIELDS.eventType,value:EVENT_TYPE_OPTIONS[data.eventType]});
  if (data.indoorOutdoor && INDOOR_OUTDOOR_OPTIONS[data.indoorOutdoor]) customFields.push({id:FIELDS.indoorOutdoor,value:INDOOR_OUTDOOR_OPTIONS[data.indoorOutdoor]});
  if (data.bookingType && BOOKING_TYPE_OPTIONS[data.bookingType]) customFields.push({id:FIELDS.bookingType,value:BOOKING_TYPE_OPTIONS[data.bookingType]});
  if (data.paymentMethod && PAYMENT_METHOD_OPTIONS[data.paymentMethod]) customFields.push({id:FIELDS.paymentMethod,value:PAYMENT_METHOD_OPTIONS[data.paymentMethod]});
  if (data.services && data.services.length) {
    const ids = data.services.map(s => SERVICES_OPTIONS[s]).filter(Boolean);
    if (ids.length) customFields.push({id:FIELDS.services,value:ids});
  }
  return customFields;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers, body:'' };
  if (event.httpMethod !== 'POST') return { statusCode:405, headers, body:JSON.stringify({message:'Method not allowed'}) };
  if (!CLICKUP_API_TOKEN) return { statusCode:500, headers, body:JSON.stringify({message:'Server configuration error'}) };
  let data; try { data = JSON.parse(event.body); } catch(e) { return { statusCode:400, headers, body:JSON.stringify({message:'Invalid JSON'}) }; }

  const required = ['clientName','clientEmail','eventName'];
  const missing = required.filter(f => !data[f]);
  if (missing.length) return { statusCode:400, headers, body:JSON.stringify({message:`Missing: ${missing.join(', ')}`}) };

  const customFields = buildCustomFields(data);
  const taskName = `${data.clientName} | ${data.eventName} | ${data.eventDate || 'TBD'}`;

  let description = `## Agreement Details\n\n**Signed by:** ${data.signedName||data.clientName}\n**Date signed:** ${data.signedDate||new Date().toISOString().split('T')[0]}\n**Terms accepted:** Yes\n\n---\n\n**Services:** ${(data.services||[]).join(', ')||'See agreement'}\n`;
  if (data.serviceNotes) description += `**Service Notes:** ${data.serviceNotes}\n`;
  if (data.eventNotes) description += `**Event Notes:** ${data.eventNotes}\n`;
  description += `\n---\n\n*Submitted via digital agreement form. Signature image attached.*`;

  try {
    let task;
    const token = data.token;

    if (token) {
      const res = await fetch(`https://api.clickup.com/api/v2/task/${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': CLICKUP_API_TOKEN },
        body: JSON.stringify({ name: taskName, description, status: 'signed', custom_fields: customFields }),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error('ClickUp update error:', res.status, err);
        return { statusCode: 502, headers, body: JSON.stringify({ message: 'Failed to update agreement', detail: err }) };
      }
      task = await res.json();
    } else {
      const res = await fetch(`https://api.clickup.com/api/v2/list/${LIST_ID}/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': CLICKUP_API_TOKEN },
        body: JSON.stringify({ name: taskName, description, status: 'signed', custom_fields: customFields }),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error('ClickUp create error:', res.status, err);
        return { statusCode: 502, headers, body: JSON.stringify({ message: 'Failed to create agreement', detail: err }) };
      }
      task = await res.json();
    }

    // Upload signature
    if (data.signatureImage) {
      try {
        const b64 = data.signatureImage.replace(/^data:image\/png;base64,/, '');
        const buf = Buffer.from(b64, 'base64');
        const boundary = '----Boundary' + Date.now().toString(36);
        const fn = `signature-${data.clientName.replace(/[^a-zA-Z0-9]/g, '-')}.png`;
        const start = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="${fn}"\r\nContent-Type: image/png\r\n\r\n`);
        const end = Buffer.from(`\r\n--${boundary}--\r\n`);
        await fetch(`https://api.clickup.com/api/v2/task/${task.id}/attachment`, {
          method: 'POST',
          headers: { 'Authorization': CLICKUP_API_TOKEN, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body: Buffer.concat([start, buf, end]),
        });
        console.log('Signature uploaded for', data.clientName);
      } catch (e) { console.error('Sig upload failed:', e.message); }
    }

    // Send confirmation email to client
    await sendClientEmail(data);

    // Notify Chat channel
    await notifyChat(data, task.url);

    return { statusCode: 200, headers, body: JSON.stringify({ message: 'Agreement submitted', taskId: task.id, taskUrl: task.url }) };
  } catch (err) {
    console.error('Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Internal server error', detail: err.message }) };
  }
};