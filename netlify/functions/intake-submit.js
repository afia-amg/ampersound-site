const LIST_ID = "901417290253";

const FIELDS = {
  email: "a32a6928-ba34-4d2f-8792-d2f63d739f90",
  phone: "2b1bdcbd-3cf9-4d03-89c6-ba4854340ae4",
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
  indoorOutdoor: "57131e3e-b145-41e1-9123-677e37994ed3",
};

const EVENT_TYPE_MAP = {
  "Wedding": "5b22ac24-ba7c-4bf1-b29a-0729804547f3",
  "Corporate": "e1388dbf-9f8a-4b1f-a120-893c55490749",
  "Conference": "b2a5866f-1520-4277-8e80-6f6b5cd5e3a7",
  "Community": "f05bbdd7-7045-45e0-b9c8-35cbce9c299c",
  "Private Party": "e8738f0d-6284-4773-93c5-cc7a63ebd31c",
  "Fundraiser": "1d250dcb-7595-4ff2-b305-74b55ae37b0a",
  "Other": "dde01e4a-d991-4618-9175-b1e0fa25a3a2"
};

const GUEST_MAP = {
  "Under 50": "375eae90-ad08-46c6-b59e-257a5a01c355",
  "50-100": "e4d8f96c-32f1-452b-b2ca-d43ce5ba5e0d",
  "100-200": "24ab31b0-2bbf-4ec1-9269-7e0ec15e5d28",
  "200-400": "7965b196-d8b2-4efc-b189-b82c8eff7a7b",
  "400+": "7e5a8dcc-bf73-44ba-8a7b-10d5c5485cf1"
};

const BUDGET_MAP = {
  "Under $1K": "2fbfb665-d9ee-4236-95d7-914c4f815ae0",
  "$1K-$1.5K": "aac5e97c-374c-419a-9eb3-41eea18c2689",
  "$1.5K-$2.5K": "7cbaf11c-b850-4dab-9404-9dd169356b57",
  "$2.5K-$4K": "5a331251-0180-49f7-b1e3-0e9880c95d96",
  "$4K+": "e27b5610-af3a-45df-9fbb-f392aa6958f7",
  "Flexible": "e27b5610-af3a-45df-9fbb-f392aa6958f7"
};

const INDOOR_MAP = {
  "Indoor": "6729e243-e299-4d2c-9fb4-045a444b10fa",
  "Outdoor": "f2f61c79-f833-46a2-97b9-b688b94a6760",
  "Both": "9c6aa961-c00e-4cae-8046-f333d94de739"
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

    // Email (email field)
    if (data.email && data.email.includes("@")) {
      customFields.push({ id: FIELDS.email, value: data.email.trim() });
    }

     // Phone (phone field - requires object format)
 if (data.phone) {
 var cleanPhone = data.phone.replace(/[^0-9+]/g, "");
 if (cleanPhone.length >= 10) {
 customFields.push({ id: FIELDS.phone, value: { phone: cleanPhone } });
 }
 }

    // Event Type (dropdown - requires UUID)
    if (data.event_type && EVENT_TYPE_MAP[data.event_type]) {
      customFields.push({ id: FIELDS.eventType, value: EVENT_TYPE_MAP[data.event_type] });
    }

    // Event Date (date field - requires unix ms)
    if (data.event_date) {
      var dateMs = new Date(data.event_date).getTime();
      if (!isNaN(dateMs)) {
        customFields.push({ id: FIELDS.eventDate, value: dateMs });
      }
    }

    // Venue (text field)
    if (data.venue) {
      customFields.push({ id: FIELDS.venue, value: data.venue });
    }

    // Guest Count (dropdown - requires UUID)
    if (data.guests && GUEST_MAP[data.guests]) {
      customFields.push({ id: FIELDS.guestCount, value: GUEST_MAP[data.guests] });
    }

    // Budget (dropdown - requires UUID)
    if (data.budget && BUDGET_MAP[data.budget]) {
      customFields.push({ id: FIELDS.budget, value: BUDGET_MAP[data.budget] });
    }

    // Vibe (multiline text)
    if (data.vibe) {
      customFields.push({ id: FIELDS.vibe, value: data.vibe });
    }

    // Must Play (multiline text)
    if (data.must_play) {
      customFields.push({ id: FIELDS.mustPlay, value: data.must_play });
    }

    // Do Not Play (multiline text)
    if (data.do_not_play) {
      customFields.push({ id: FIELDS.doNotPlay, value: data.do_not_play });
    }

    // Business Name (text)
    if (data.business_name) {
      customFields.push({ id: FIELDS.businessName, value: data.business_name });
    }

    // How Heard / Referral (text field)
    if (data.referral) {
      customFields.push({ id: FIELDS.howHeard, value: data.referral });
    }

    // Indoor/Outdoor (dropdown - requires UUID)
    if (data.indoor_outdoor && INDOOR_MAP[data.indoor_outdoor]) {
      customFields.push({ id: FIELDS.indoorOutdoor, value: INDOOR_MAP[data.indoor_outdoor] });
    }

    // Build description with all data as backup
    var services = Array.isArray(data.svc) ? data.svc.join(", ") : (data.svc || "Not specified");
    var description = [
      "Lead submitted via website intake form",
      "",
      "Name: " + (data.name || "Not provided"),
      "Email: " + (data.email || "Not provided"),
      "Phone: " + (data.phone || "Not provided"),
      "Event Type: " + (data.event_type || "Not specified"),
      "Event Date: " + (data.event_date || "TBD"),
      "Venue: " + (data.venue || "TBD"),
      "Guests: " + (data.guests || "Not specified"),
      "Budget: " + (data.budget || "Not specified"),
      "Services: " + services,
      "Vibe: " + (data.vibe || "Not provided"),
      "Must-plays: " + (data.must_play || "None"),
      "Do-not-plays: " + (data.do_not_play || "None"),
      "Referral: " + (data.referral || "Not specified"),
      "Notes: " + (data.notes || "None"),
    ].join("\n");

    // Create task in ClickUp
    var response = await fetch(
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
      var error = await response.text();
      console.error("ClickUp API error:", error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to create task" }) };
    }

    var task = await response.json();
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, taskId: task.id }) };
  } catch (err) {
    console.error("Function error:", err);
           return { statusCode: 500, headers, body: JSON.stringify({ error: "Server error" }) };
  }
};
