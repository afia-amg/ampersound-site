const LIST_ID = "901417290253";

const FIELDS = {
  email: "a32a6928-ba34-4d2f-8792-d2f63d739f90",
  eventType: "786532a3-73ff-4ff5-8d78-f49a66670bea",
  eventDate: "e8b8ef29-f447-4bd9-affc-8a39bfcd718f",
  venue: "a1b16a05-e8cf-48e0-b284-0695a9f88744",
  guestCount: "9f520eca-1eee-4e8a-a30b-eb017edcd9b9",
  budget: "91f8e05c-0b7e-4290-a8f2-b28c4a540825",
  vibe: "a7ca3056-77c6-4e7c-99cf-551296383c3f",
  mustPlay: "f6f085c8-6d03-4b29-88ce-2c005d68b91f",
  doNotPlay: "a64d3333-7c86-4d16-8967-f8e6a569ac17",
  businessName: "859f2865-375b-444b-a80e-88d941740249",
  howHeard: "2cdd3842-f23c-4e3e-8d7e-39b2fd026e42",
  duration: "0a857745-8852-4df9-b0bf-33f6147a2c4f",
  indoorOutdoor: "57131e3e-b145-41e1-9123-677e37994ed3",
};

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    if (data.email) customFields.push({ id: FIELDS.email, value: data.email });
    if (data.event_type) customFields.push({ id: FIELDS.eventType, value: data.event_type });
    if (data.event_date) customFields.push({ id: FIELDS.eventDate, value: new Date(data.event_date).getTime() });
    if (data.venue) customFields.push({ id: FIELDS.venue, value: data.venue });
    if (data.guest_count) customFields.push({ id: FIELDS.guestCount, value: data.guest_count });
    if (data.budget) customFields.push({ id: FIELDS.budget, value: data.budget });
    if (data.vibe) customFields.push({ id: FIELDS.vibe, value: data.vibe });
    if (data.must_play) customFields.push({ id: FIELDS.mustPlay, value: data.must_play });
    if (data.do_not_play) customFields.push({ id: FIELDS.doNotPlay, value: data.do_not_play });
    if (data.business_name) customFields.push({ id: FIELDS.businessName, value: data.business_name });
    if (data.referral) customFields.push({ id: FIELDS.howHeard, value: data.referral });
    if (data.duration) customFields.push({ id: FIELDS.duration, value: data.duration });
    if (data.indoor_outdoor) customFields.push({ id: FIELDS.indoorOutdoor, value: data.indoor_outdoor });

    const description = [
      "Lead submitted via website intake form",
      "",
      "Name: " + (data.name || "Not provided"),
      "Email: " + (data.email || "Not provided"),
      "Event Type: " + (data.event_type || "Not specified"),
      "Event Date: " + (data.event_date || "TBD"),
      "Venue: " + (data.venue || "TBD"),
      "Guests: " + (data.guest_count || "Not specified"),
      "Budget: " + (data.budget || "Not specified"),
      "Services: " + (Array.isArray(data.svc) ? data.svc.join(", ") : data.svc || "Not specified"),
      "Vibe: " + (data.vibe || "Not provided"),
      "Must-plays: " + (data.must_play || "None"),
      "Do-not-plays: " + (data.do_not_play || "None"),
      "Referral: " + (data.referral || "Not specified"),
      "Notes: " + (data.notes || "None"),
    ].join("\n");

    const response = await fetch(
      "https://api.clickup.com/api/v2/list/" + LIST_ID + "/task",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: process.env.CLICKUP_API_TOKEN,
        },
        body: JSON.stringify({
          name: data.name || "New Intake Submission",
          description: description,
          status: "unqualified prospect",
          custom_fields: customFields,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("ClickUp API error:", error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to create task" }) };
    }

    const task = await response.json();
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, taskId: task.id }) };
  } catch (err) {
    console.error("Function error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server error" }) };
  }
};
