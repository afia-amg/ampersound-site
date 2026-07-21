const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CF = {
  clientName: '01b694ba-6da6-4e4c-a3d3-af4b96a7a0c5',
  organization: 'aeeee479-3136-47c0-b10e-a2512f92a065',
  clientEmail: '3f38f15e-6aa4-4481-9365-d4a911d68195',
  clientPhone: 'c76029af-56b9-4079-aef8-7af4c6d87a1e',
  mailingAddress: 'fdba9ebc-a9da-4273-941f-1f61a7492c47',
  eventName: '4299965c-96e2-430e-947a-ac16e9068aee',
  eventDate: '4006b42c-6597-49ea-bbb6-beb6bcc323b8',
  eventType: 'f36884b1-eb6a-40b4-b1eb-ab75d0370ebc',
  startTime: 'c694927d-9f80-45bc-a99f-5ba5b2b1929c',
  endTime: 'ac7880e0-051f-4208-a7b5-819243839076',
  venueName: '25f7eed6-37ba-49e7-918a-e6040531b58f',
  venueAddress: 'bde68d62-d513-4406-b65b-23923f723c37',
  guestCount: 'a0aae2d5-a1b1-4a81-aaa0-fdbbd0294d48',
  indoorOutdoor: '087e8d6a-f58e-4fff-8589-328bab2e2a36',
  eventNotes: 'c0d6e105-1e95-4553-b269-b4af4af28826',
  serviceNotes: 'cf2c16a3-ae59-4246-88b1-8783e0267458',
  services: '605ff2b7-983f-43e1-8f78-fc684d140f80',
  totalFee: 'a60f1fb7-4558-4cac-825c-abb9ea9a11e7',
  depositAmount: 'f18252f2-13c7-4b04-a8d3-2b38dc096791',
  balanceDue: '61d4c0c8-2f98-46ba-9c6e-fec7ca31981c',
  depositDueDate: '66f05f1f-175f-4227-ad48-544f22923d3b',
  balanceDueDate: 'c74c04b1-9999-48b1-a885-819166b664ad',
  bookingType: 'e70b1c01-e9f9-4608-8742-39b933395cae',
  paymentMethod: '81020cc8-bdad-4008-9507-db8c8a520b87',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method not allowed' }) };
  if (!CLICKUP_API_TOKEN) return { statusCode: 500, headers, body: JSON.stringify({ message: 'Server configuration error' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid request' }) }; }

  const taskId = (body.token || '').trim();
  if (!taskId) return { statusCode: 400, headers, body: JSON.stringify({ message: 'Token required' }) };

  try {
    const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
      headers: { 'Authorization': CLICKUP_API_TOKEN },
    });

    if (!res.ok) {
      return { statusCode: 404, headers, body: JSON.stringify({ message: 'Agreement not found' }) };
    }

    const task = await res.json();
    const fields = task.custom_fields || [];

    const getField = (id) => {
      const f = fields.find(cf => cf.id === id);
      if (!f || f.value === null || f.value === undefined) return null;
      switch (f.type) {
        case 'short_text': case 'text': case 'email': case 'phone': case 'url': return f.value || null;
        case 'number': return f.value;
        case 'currency': return f.value;
        case 'date': return f.value ? new Date(Number(f.value)).toISOString().split('T')[0] : null;
        case 'drop_down':
          if (f.type_config && f.type_config.options) {
            const opt = f.type_config.options.find(o => o.orderindex === f.value);
            return opt ? opt.name : null;
          }
          return null;
        case 'labels':
          if (Array.isArray(f.value)) return f.value.map(v => v.label || v.name || v).filter(Boolean);
          return [];
        default: return f.value;
      }
    };

    const status = task.status ? task.status.status.toLowerCase() : 'to do';
    const statusType = task.status ? (task.status.type || '') : '';
    const isSigned = statusType === 'done' || statusType === 'closed' || status === 'complete' || status === 'closed';

    const agreement = {
      taskId: task.id,
      status: isSigned ? 'signed' : 'pending',
      clientName: getField(CF.clientName),
      organization: getField(CF.organization),
      clientEmail: getField(CF.clientEmail),
      clientPhone: getField(CF.clientPhone),
      mailingAddress: getField(CF.mailingAddress),
      eventName: getField(CF.eventName),
      eventDate: getField(CF.eventDate),
      eventType: getField(CF.eventType),
      startTime: getField(CF.startTime),
      endTime: getField(CF.endTime),
      venueName: getField(CF.venueName),
      venueAddress: getField(CF.venueAddress),
      guestCount: getField(CF.guestCount),
      indoorOutdoor: getField(CF.indoorOutdoor),
      eventNotes: getField(CF.eventNotes),
      serviceNotes: getField(CF.serviceNotes),
      services: getField(CF.services),
      totalFee: getField(CF.totalFee),
      depositAmount: getField(CF.depositAmount),
      balanceDue: getField(CF.balanceDue),
      depositDueDate: getField(CF.depositDueDate),
      balanceDueDate: getField(CF.balanceDueDate),
      bookingType: getField(CF.bookingType),
      paymentMethod: getField(CF.paymentMethod),
    };

    return { statusCode: 200, headers, body: JSON.stringify(agreement) };
  } catch (err) {
    console.error('Load agreement error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Internal error' }) };
  }
};