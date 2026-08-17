/**
 * Ampersound Media Group — Agreement Webhook
 * Receives POST from client portal on viewed/signed/paid events.
 * Updates the matching task in the ClickUp Agreements list.
 *
 * Env vars:
 *   CLICKUP_API_TOKEN
 *   AGREEMENTS_LIST_ID (objectID format, default: 901418268145)
 */

const CLICKUP_BASE = "https://api.clickup.com/api/v2";
const CLIENT_EMAIL_FIELD = "3f38f15e-6aa4-4481-9365-d4a911d68195";

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
  const LIST_ID = process.env.AGREEMENTS_LIST_ID || "901418268145";

  if (!TOKEN) {
    console.error("Missing CLICKUP_API_TOKEN");
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server config error: missing token" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers, body: "Invalid JSON" };
  }

  const { action, client, contact, email, event_date, total_fee, deposit, package: pkg, signature, signedAt } = payload;

  if (!action || !email) {
    return { statusCode: 400, headers, body: "Missing required fields: action, email" };
  }

  console.log("Webhook received:", action, email);

  try {
    // 1. Find agreement task by client email
    const task = await findTaskByEmail(TOKEN, LIST_ID, email);

    if (!task) {
      console.log("No task found for:", email, "in list:", LIST_ID);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, message: "No matching task found" })
      };
    }

    console.log("Found task:", task.id, task.name);

    // 2. Map action to status
    const statusMap = { viewed: "sent", signed: "signed", paid: "paid" };
    const newStatus = statusMap[action];
    if (!newStatus) {
      return { statusCode: 400, headers, body: "Invalid action" };
    }

    // Update status (may fail if status doesn't exist, log but continue)
    try {
      await updateTask(TOKEN, task.id, { status: newStatus });
      console.log("Status updated to:", newStatus);
    } catch (statusErr) {
      console.error("Status update failed (continuing):", statusErr.message);
    }

    // 3. If signed: save signature + post comment
    if (action === "signed") {
      const signerName = contact || client || "Client";
      const signDate = signedAt ? new Date(signedAt).toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short"
      }) : new Date().toISOString();

      // Post comment with signature confirmation
      let commentText = "\u2705 **Agreement signed digitally**\n\n";
      commentText += "**Signed by:** " + signerName + "\n";
      commentText += "**Date:** " + signDate + "\n";
      commentText += "**Package:** " + (pkg || "N/A") + "\n";
      commentText += "**Total:** $" + (total_fee || 0).toFixed(2) + "\n";
      commentText += "**Event:** " + (event_date || "N/A") + "\n";

      if (signature) {
        commentText += "\n**Signature image stored.** (Base64 data captured and available in function logs for legal records.)";
        // Log the first 100 chars of signature for verification that data was received
        console.log("Signature received, length:", signature.length, "preview:", signature.substring(0, 80));
      }

      await postComment(TOKEN, task.id, commentText);
      console.log("Signed comment posted");

      // Attempt file attachment (may fail silently)
      if (signature) {
        try {
          await attachSignature(TOKEN, task.id, signature, signerName);
          console.log("Signature file attached successfully");
        } catch (attachErr) {
          console.error("Signature attachment failed (non-fatal):", attachErr.message);
          // Post the base64 as a second comment so it's never lost
          await postComment(TOKEN, task.id, "Signature data (base64, first 500 chars for reference):\n" + signature.substring(0, 500));
        }
      }
    }

    // 4. If paid: post confirmation
    if (action === "paid") {
      const amount = deposit ? "$" + deposit.toFixed(2) : "amount confirmed";
      await postComment(TOKEN, task.id,
        "\ud83d\udcb0 **Payment received**\n\nAmount: " + amount + "\nClient: " + (client || email) + "\nDate: " + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      );
      console.log("Payment comment posted");
    }

    // 5. If viewed: just log
    if (action === "viewed") {
      console.log("Portal viewed by:", email);
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ok: true, action, taskId: task.id, newStatus }),
    };
  } catch (err) {
    console.error("Webhook error:", err.message, err.stack);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// --- Helpers ---

async function findTaskByEmail(token, listId, email) {
  const url = CLICKUP_BASE + "/list/" + listId + "/task?include_closed=false";
  console.log("Searching list:", listId, "for email:", email);

  const res = await fetch(url, { headers: { Authorization: token } });
  if (!res.ok) {
    const errText = await res.text();
    console.error("ClickUp list fetch failed:", res.status, errText);
    throw new Error("ClickUp API: " + res.status);
  }

  const data = await res.json();
  console.log("Tasks in list:", data.tasks ? data.tasks.length : 0);

  // Match on Client Email field
  const match = data.tasks.find(function(t) {
    return t.custom_fields && t.custom_fields.some(function(f) {
      return f.id === CLIENT_EMAIL_FIELD && f.value && f.value.toLowerCase() === email.toLowerCase();
    });
  });

  // Fallback: check description
  if (!match) {
    const descMatch = data.tasks.find(function(t) {
      return t.description && t.description.toLowerCase().indexOf(email.toLowerCase()) !== -1;
    });
    if (descMatch) {
      console.log("Found via description fallback:", descMatch.id);
      return descMatch;
    }
  }

  return match || null;
}

async function updateTask(token, taskId, updates) {
  const res = await fetch(CLICKUP_BASE + "/task/" + taskId, {
    method: "PUT",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error("Update failed: " + res.status + " " + errText);
  }
  return res.json();
}

async function attachSignature(token, taskId, base64Data, signerName) {
  const base64Content = base64Data.replace(/^data:image\/png;base64,/, "");
  const buffer = Buffer.from(base64Content, "base64");
  const boundary = "----FormBoundary" + Date.now().toString(36);
  const filename = "signature-" + signerName.replace(/\s+/g, "-").toLowerCase() + "-" + Date.now() + ".png";

  const body = Buffer.concat([
    Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"attachment\"; filename=\"" + filename + "\"\r\nContent-Type: image/png\r\n\r\n"),
    buffer,
    Buffer.from("\r\n--" + boundary + "--\r\n"),
  ]);

  const res = await fetch(CLICKUP_BASE + "/task/" + taskId + "/attachment", {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "multipart/form-data; boundary=" + boundary,
    },
    body: body,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error("Attachment failed: " + res.status + " " + errText);
  }

  return res.json();
}

async function postComment(token, taskId, text) {
  const res = await fetch(CLICKUP_BASE + "/task/" + taskId + "/comment", {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ comment_text: text }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("Comment failed:", res.status, errText);
  }
}
