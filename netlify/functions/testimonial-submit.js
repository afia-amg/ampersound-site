// Website testimonial form. Reviews land in Sales Operations > Post-Event as
// "received" so they sit next to the portal reviews. The old target list no
// longer exists, which is why earlier submissions failed.
const LIST_ID = "901418578200";

const FIELDS = {
  clientName: "01b694ba-6da6-4e4c-a3d3-af4b96a7a0c5",
  eventType: "68bb0023-9d06-469e-a615-e2a31053bf76",
  rating: "6bee26d1-b86e-46ef-b523-50f6261f702e",
  testimonial: "39d4731e-5ae4-41be-8c3f-bb8701814691",
  highlight: "b9310261-4733-4541-9ee6-854397abc11a",
  publishStatus: "f39956bc-e153-47f8-a47e-413a0eb347b6",
  testimonialStatus: "46af20f3-ccab-4340-84c2-cf1d41482949"
};
const PUBLISH_RECEIVED = "d05fc3dd-ad80-4c17-ae08-5b81397ded24";
const STATUS_RECEIVED = "1547b5ce-0cd0-4f31-9ba6-307e181c4d91";

const EVENT_TYPE_MAP = {
  "Wedding": "4ceebbd3-8331-416b-a1a6-de97d4ba5abb",
  "Corporate": "3cf4d5e0-785e-4ed3-995c-d8ea02ca1a16",
  "Conference": "68caa299-21e3-47fb-9a4b-fc746d8b2506",
  "Private Party": "8cb8e518-2d06-42b1-9bf1-ef46798916e0",
  "Community Event": "c7fe079a-03ec-4504-8ca3-e3af692c1908",
  "Speaking/Keynote": "9448a93f-782a-48f8-9194-91b3b08edcca",
  "Other": "9448a93f-782a-48f8-9194-91b3b08edcca"
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
    const rating = parseInt(data.rating);
    const customFields = [
      { id: FIELDS.publishStatus, value: PUBLISH_RECEIVED },
      { id: FIELDS.testimonialStatus, value: STATUS_RECEIVED }
    ];
    if (data.name) customFields.push({ id: FIELDS.clientName, value: String(data.name).slice(0, 120) });
    if (data.event_type && EVENT_TYPE_MAP[data.event_type]) {
      customFields.push({ id: FIELDS.eventType, value: EVENT_TYPE_MAP[data.event_type] });
    }
    if (rating >= 1 && rating <= 5) customFields.push({ id: FIELDS.rating, value: rating });
    if (data.testimonial) customFields.push({ id: FIELDS.testimonial, value: String(data.testimonial).slice(0, 3000) });
    if (data.highlight) customFields.push({ id: FIELDS.highlight, value: String(data.highlight).slice(0, 300) });
    var description = "Testimonial submitted via website\n\nName: " + (data.name || "Anonymous") + "\nEvent Type: " + (data.event_type || "Not specified") + "\nRating: " + (data.rating || "?") + "/5\nTestimonial: " + (data.testimonial || "") + "\nBest Part: " + (data.highlight || "Not specified");
    var today = new Date().toISOString().slice(0, 10);
    var response = await fetch("https://api.clickup.com/api/v2/list/" + LIST_ID + "/task", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: process.env.CLICKUP_API_TOKEN },
      body: JSON.stringify({ name: (data.name || "Anonymous") + " | Website Review | " + today, description: description, status: "received", custom_fields: customFields })
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
