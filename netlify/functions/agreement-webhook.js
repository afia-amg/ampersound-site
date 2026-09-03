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

  const {
    action, client, contact, email, event_date,
    total_fee, deposit, package: pkg, signature, signedAt,
    task_id
  } = payload;

  if (!action || !email) {
    return { statusCode: 400, headers, body: "Missing required fields: action, email" };
  }

  console.log("Webhook received:", action, email, task_id ? "(task_id: " + task_id + ")" : "(no task_id)");

  try {
    // 1. Resolve task: prefer direct lookup by task_id, fall back to email scan
    let task = null;

    if (task_id) {
      task = await getTaskById(TOKEN, task_id);
      if (task) {
        console.log("Resolved task by task_id:", task.id, task.name);
      } else {
        console.log("task_id", task_id, "not found, falling back to email scan");
      }
    }

    if (!task) {
      task = await findTaskByEmail(TOKEN, LIST_ID, email);
    }

    if (!task) {
      console.log("No task found for:", email, "in list:", LIST_ID);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, message: "No matching task found" })
      };
    }

    console.log("Using task:", task.id, task.name);

    // 2. If signed: post signature comment FIRST (before status change)
    if (action === "signed") {
      const signerName = contact || client || "Client";
      const signDate = signedAt ? new Date(signedAt).toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short"
      }) : new Date().toISOString();

      // Post signature confirmation comment
      let commentText = "\u2705 **Agreement signed digitally**\n\n";
      commentText += "**Signed by:** " + signerName + "\n";
      commentText += "**Date:** " + signDate + "\n";
      commentText += "**Package:** " + (pkg || "N/A") + "\n";
      commentText += "**Total:** $" + (total_fee || 0).toFixed(2) + "\n";
      commentText += "**Event:** " + (event_date || "N/A") + "\n";

      await postComment(TOKEN, task.id, commentText);
      console.log("Signed confirmation comment posted");

      // Store signature as separate comment with full base64 data URL
      // This is the most reliable approach: no multipart, no timeout risk
      if (signature) {
        const sigComment = "\ud83d\udd8a\ufe0f **Digital Signature Image**\n\n" +
          "Signer: " + signerName + "\n" +
          "Timestamp: " + signDate + "\n\n" +
          "Signature data (base64 PNG):\n" + signature;
        await postComment(TOKEN, task.id, sigComment);
        console.log("Signature data saved in comment, length:", signature.length);
      }
    }

    // 3. Update status AFTER comments are saved
    const statusMap = { viewed: "sent", signed: "signed", paid: "paid" };
    const newStatus = statusMap[action];
    if (newStatus) {
      try {
        await updateTask(TOKEN, task.id, { status: newStatus });
        console.log("Status updated to:", newStatus);
      } catch (statusErr) {
        console.error("Status update failed (continuing):", statusErr.message);
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

/**
 * Direct task lookup by ClickUp task ID.
 * Returns the task object or null if not found / unauthorized.
 */
async function getTaskById(token, taskId) {
  const url = CLICKUP_BASE + "/task/" + taskId;
  const res = await fetch(url, { headers: { Authorization: token } });
  if (!res.ok) {
    console.log("getTaskById failed:", res.status, "for", taskId);
    return null;
  }
  return res.json();
}

async function findTaskByEmail(token, listId, email) {
  const url = CLICKUP_BASE + "/list/" + listId + "/task?include_closed=true&subtasks=false";
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

async function postComment(token, taskId, text) {
  const res = await fetch(CLICKUP_BASE + "/task/" + taskId + "/comment", {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ comment_text: text }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("Comment failed:", res.status, errText);
    throw new Error("Comment failed: " + res.status);
  }
}
