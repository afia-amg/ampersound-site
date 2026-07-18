const LIST_ID = "901418214868";

const FIELDS = {
  clientName: "01b694ba-6da6-4e4c-a3d3-af4b96a7a0c5",
  eventType: "477e8901-af2f-457a-b9bd-94cc906a2a40",
  rating: "6bee26d1-b86e-46ef-b523-50f6261f702e",
  testimonial: "80b8a95d-448a-4720-9aa2-20df10855944",
  highlight: "b9310261-4733-4541-9ee6-854397abc11a"
};

const EVENT_TYPE_MAP = {
  "Wedding": "25beb2ba-a475-461f-93a3-873217ac0563",
  "Corporate": "49ee7ac3-0982-4b31-8bb2-ff00b5ae528b",
  "Conference": "daaf7d1d-8379-472e-af10-2184fa587d34",
  "Private Party": "7cd52b03-7806-4148-b1b7-6ef4ced2905c",
  "Community Event": "433606ff-a6c1-413c-a6cb-c5c15db9d4a2",
  "Speaking/Keynote": "248c1572-2dbd-4372-be8c-1973b5056459",
  "Other": "12ec2728-d7b5-4230-887d-771b6b2f2839"
};

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: "Method not allowed" };
  }
  try {
    const data = JSON.parse(event.body);
    const customFields = [];
    if (data.name) customFields.push({ id: FIELDS.clientName, value: data.name });
    if (data.event_type && EVENT_TYPE_MAP[data.event_type]) {
      customFields.push({ id: FIELDS.eventType, value: EVENT_TYPE_MAP[data.event_type] });
    }
    if (data.rating) customFields.push({ id: FIELDS.rating, value: parseInt(data.rating) });
    if (data.testimonial) customFields.push({ id: FIELDS.testimonial, value: data.testimonial });
    if (data.highlight) customFields.push({ id: FIELDS.highlight, value: data.highlight });
    var description = "Testimonial submitted via website\n\nName: " + (data.name || "Anonymous") + "\nEvent Type: " + (data.event_type || "Not specified") + "\nRating: " + (data.rating || "?") + "/5\nTestimonial: " + (data.testimonial || "") + "\nBest Part: " + (data.highlight || "Not specified");
    var response = await fetch("https://api.clickup.com/api/v2/list/" + LIST_ID + "/task", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: process.env.CLICKUP_API_TOKEN },
      body: JSON.stringify({ name: (data.name || "Anonymous") + " | " + (data.event_type || "Review"), description: description, status: "qualified prospect", custom_fields: customFields })
    });
    if (!response.ok) {
      var error = await response.text();
      console.error("ClickUp API error:", error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed" }) };
    }
    var task = await response.json();
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, taskId: task.id }) };
  } catch (err) {
    console.error("Function error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server error" }) };
  }
};
