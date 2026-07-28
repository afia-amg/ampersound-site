/**
 * Ampersound Media Group — Agreement Webhook
 * Receives POST from client portal on viewed/signed/paid events.
 * Updates the matching task in the ClickUp Agreements list.
 *
 * Env vars (set in Netlify dashboard):
 *   CLICKUP_API_TOKEN - ClickUp personal API token
 *   AGREEMENTS_LIST_ID - 4027438415107101193
 */

const CLICKUP_BASE = "https://api.clickup.com/api/v2";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: "Method not allowed" };
  }

  const TOKEN = process.env.CLICKUP_API_TOKEN;
  const LIST_ID = process.env.AGREEMENTS_LIST_ID || "4027438415107101193";

  if (!TOKEN) {
    console.error("Missing CLICKUP_API_TOKEN");
    return { statusCode: 500, headers, body: "Server config error" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers, body: "Invalid JSON" };
  }

  const {
    action, client, contact, email,
    event_date, total_fee, deposit,
    package: pkg, signature, signedAt
  } = payload;

  if (!action || !email) {
    return { statusCode: 400, headers, body: "Missing required fields" };
  }

  try {
    // 1. Find agreement task by client email
    const task = await findTaskByEmail(TOKEN, LIST_ID, email);

    if (!task) {
      console.log(`No task found for: ${email}`);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, message: "No matching task" })
      };
    }

    // 2. Map action to status
    const statusMap = {
      viewed: "sent",
      signed: "signed",
      paid: "paid",
    };

    const newStatus = statusMap[action];
    if (!newStatus) {
      return { statusCode: 400, headers, body: "Invalid action" };
    }

    await updateTask(TOKEN, task.id, { status: newStatus });

    // 3. If signed, attach signature image + comment
    if (action === "signed" && signature) {
      await attachSignature(TOKEN, task.id, signature, contact || client);
      await postComment(TOKEN, task.id,
        `\u2713 Agreement signed digitally by ${contact || client} on ${new Date(signedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`
      );
    }

    // 4. If paid, post confirmation
    if (action === "paid") {
      await postComment(TOKEN, task.id,
        `\ud83d\udcb0 Deposit of $${deposit.toFixed(2)} received via Stripe. Date confirmed.`
      );
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ok: true, action, taskId: task.id, newStatus }),
    };
  } catch (err) {
    console.error("Webhook error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// --- Helper Functions ---

async function findTaskByEmail(token, listId, email) {
  const url = `${CLICKUP_BASE}/list/${listId}/task?include_closed=false`;
  const res = await fetch(url, { headers: { Authorization: token } });
  if (!res.ok) throw new Error(`ClickUp API: ${res.status}`);
  const data = await res.json();

  // Match on Client Email field (ID: 3f38f15e-6aa4-4481-9365-d4a911d68195)
  return data.tasks.find((t) =>
    t.custom_fields?.some(
      (f) => f.id === "3f38f15e-6aa4-4481-9365-d4a911d68195" && f.value === email
    )
  ) || null;
}

async function updateTask(token, taskId, updates) {
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}`, {
    method: "PUT",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Update failed: ${res.status}`);
  return res.json();
}

async function attachSignature(token, taskId, base64Data, signerName) {
  const base64Content = base64Data.replace(/^data:image\/png;base64,/, "");
  const buffer = Buffer.from(base64Content, "base64");
  const boundary = "----FormBoundary" + Date.now().toString(36);
  const filename = `signature-${signerName.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.png`;

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}/attachment`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) console.error("Signature attach failed:", res.status);
}

async function postComment(token, taskId, text) {
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}/comment`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ comment_text: text }),
  });
  if (!res.ok) console.error("Comment failed:", res.status);
}
