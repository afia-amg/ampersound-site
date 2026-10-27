/**
 * Ampersound Media Group — Agreement Webhook
 * Receives POST from client portal on viewed/signed/paid/installment events.
 * Updates the matching task in the ClickUp Agreements list.
 *
 * Signatures are saved as a PNG attachment on the agreement task (viewable
 * in ClickUp), with a text comment as the fallback if the upload fails.
 *
 * Signed / paid / installment events with no matching agreement return 404,
 * so the portal keeps the submission queued and tells the client plainly,
 * instead of showing a success while nothing was recorded.
 *
 * Env vars:
 *   CLICKUP_API_TOKEN
 *   AGREEMENTS_LIST_ID (objectID format, default: 901418268145)
 */

const CLICKUP_BASE = "https://api.clickup.com/api/v2";
const CLIENT_EMAIL_FIELD = "3f38f15e-6aa4-4481-9365-d4a911d68195";
const PAYMENT_STATUS_FIELD = "96105ecf-6396-4fb1-90aa-93b37c9dfc48";
const PAYMENT_RECEIVED_OPTION = "7601cdf4-5cee-49ef-a8bf-802350a5bdcc";
const MUST_RECORD = ["signed", "paid", "installment"];
const DEFAULT_LIST_ID = "901418268145";

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
  const LIST_ID = process.env.AGREEMENTS_LIST_ID || DEFAULT_LIST_ID;

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
    total_fee, deposit, package: pkg, signature, signedAt, signerName: signerFromPortal,
    task_id
  } = payload;

  if (!action || !email) {
    return { statusCode: 400, headers, body: "Missing required fields: action, email" };
  }

  console.log("Webhook received:", action, email, task_id ? "(task_id: " + task_id + ")" : "(no task_id)");

  try {
    // 1. Resolve task: prefer direct lookup by task_id, fall back to email scan
    let task = null;
    let resolvedById = false;

    if (task_id) {
      task = await getTaskById(TOKEN, task_id);
      if (task) {
        resolvedById = true;
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
      // A signature or payment that lands nowhere must not look like a success.
      if (MUST_RECORD.indexOf(action) !== -1) {
        return {
          statusCode: 404, headers,
          body: JSON.stringify({ ok: false, message: "No matching agreement found for " + email })
        };
      }
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, message: "No matching task found" })
      };
    }

    console.log("Using task:", task.id, task.name);
    const currentStatus = ((task.status && task.status.status) || "").toLowerCase();

    // 2. If signed: save the signature FIRST (before status change)
    let signatureSaved = null;
    if (action === "signed") {
      const signerName = signerFromPortal || contact || client || "Client";
      const signDate = signedAt ? new Date(signedAt).toLocaleString("en-US", {
        timeZone: "America/Denver",
        year: "numeric", month: "long", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short"
      }) : new Date().toISOString();

      if (signature) {
        const fileName = "signature-" + slugify(signerName) + "-" + (signedAt || new Date().toISOString()).slice(0, 10) + ".png";
        try {
          await uploadAttachment(TOKEN, task.id, signature, fileName);
          signatureSaved = "attachment";
          console.log("Signature uploaded as attachment:", fileName);
        } catch (upErr) {
          console.error("Signature attachment failed, falling back to comment:", upErr.message);
          const sigComment = "\ud83d\udd8a\ufe0f **Digital Signature Image**\n\n" +
            "Signer: " + signerName + "\n" +
            "Timestamp: " + signDate + "\n\n" +
            "Signature data (base64 PNG):\n" + signature;
          await postComment(TOKEN, task.id, sigComment);
          signatureSaved = "comment";
        }
      }

      let commentText = "\u2705 **Agreement signed digitally**\n\n";
      commentText += "**Signed by:** " + signerName + "\n";
      commentText += "**Date:** " + signDate + "\n";
      commentText += "**Package:** " + (pkg || "N/A") + "\n";
      commentText += "**Total:** $" + Number(total_fee || 0).toFixed(2) + "\n";
      commentText += "**Event:** " + (event_date || "N/A") + "\n";
      commentText += "**Signature:** " + (signatureSaved === "attachment"
        ? "saved as an image attachment on this task"
        : signatureSaved === "comment" ? "saved as data in the comment below" : "not included") + "\n";

      await postComment(TOKEN, task.id, commentText);
      console.log("Signed confirmation comment posted");
    }

    // 3. Update status AFTER the signature is saved.
    //    "viewed" only advances a draft, so it never reverts a signed agreement.
    let newStatus = null;
    if (action === "signed") newStatus = "signed";
    if (action === "viewed" && currentStatus === "draft") newStatus = "sent";
    if (newStatus) {
      try {
        await updateTask(TOKEN, task.id, { status: newStatus });
        console.log("Status updated to:", newStatus);
      } catch (statusErr) {
        console.error("Status update failed (continuing):", statusErr.message);
      }
    }

    // 4. If paid: mark Payment Status and post confirmation
    if (action === "paid") {
      try {
        await setField(TOKEN, task.id, PAYMENT_STATUS_FIELD, PAYMENT_RECEIVED_OPTION);
        console.log("Payment Status set to Payment Received");
      } catch (fieldErr) {
        console.error("Payment Status update failed (continuing):", fieldErr.message);
      }
      const amount = deposit ? "$" + Number(deposit).toFixed(2) : "amount confirmed";
      await postComment(TOKEN, task.id,
        "\ud83d\udcb0 **Payment received**\n\nAmount: " + amount + "\nClient: " + (client || email) + "\nDate: " + new Date().toLocaleDateString("en-US", { timeZone: "America/Denver", year: "numeric", month: "long", day: "numeric" })
      );
      console.log("Payment comment posted");
    }

    // 4b. Installment plans: the portal sends the installment's own task_id.
    // Log the payment there, and close that task only when we resolved it
    // directly, so an email-scan fallback can never close the main agreement.
    // The Stripe webhook usually gets there first; if the task is already
    // completed, this is a duplicate and we leave it alone.
    if (action === "installment") {
      const already = resolvedById && currentStatus === "completed";
      if (already) {
        console.log("Installment already logged, skipping:", task.id);
      } else {
        const n = payload.installment;
        const of = payload.installments;
        const amt = typeof payload.amount === "number" ? "$" + payload.amount.toFixed(2) : "amount confirmed";
        await postComment(TOKEN, task.id,
          "\ud83d\udcb0 **Installment " + n + (of ? " of " + of : "") + " received**\n\nAmount: " + amt +
          "\nClient: " + (client || email) + "\nDate: " + new Date().toLocaleDateString("en-US", { timeZone: "America/Denver", year: "numeric", month: "long", day: "numeric" })
        );
        console.log("Installment comment posted:", n);
        if (resolvedById) {
          try {
            await updateTask(TOKEN, task.id, { status: "completed" });
            console.log("Installment task closed:", task.id);
          } catch (statusErr) {
            console.error("Installment status update failed (continuing):", statusErr.message);
          }
        }
      }
    }

    // 5. If viewed: just log
    if (action === "viewed") {
      console.log("Portal viewed by:", email);
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ok: true, action, taskId: task.id, newStatus, signatureSaved }),
    };
  } catch (err) {
    console.error("Webhook error:", err.message, err.stack);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// --- Helpers ---

function slugify(s) {
  return String(s || "client").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client";
}

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
  // The env var has held an internal-format ID before, which the ClickUp API
  // rejects with a 400. Try it, then fall back to the known Agreements list.
  const candidates = [listId, DEFAULT_LIST_ID].filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  let data = null;
  let lastErr = "";
  for (const id of candidates) {
    const url = CLICKUP_BASE + "/list/" + id + "/task?include_closed=true&subtasks=false";
    console.log("Searching list:", id, "for email:", email);
    const res = await fetch(url, { headers: { Authorization: token } });
    if (res.ok) { data = await res.json(); break; }
    lastErr = res.status + " " + (await res.text());
    console.error("ClickUp list fetch failed for", id, ":", lastErr);
  }
  if (!data) throw new Error("ClickUp API: " + lastErr);

  console.log("Tasks in list:", data.tasks ? data.tasks.length : 0);

  // Match on Client Email field
  const match = data.tasks.find(function(t) {
    return t.custom_fields && t.custom_fields.some(function(f) {
      return f.id === CLIENT_EMAIL_FIELD && typeof f.value === "string" && f.value.toLowerCase() === email.toLowerCase();
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

async function uploadAttachment(token, taskId, dataUrl, fileName) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl || "");
  if (!m) throw new Error("Signature is not a base64 image data URL");
  const bytes = Buffer.from(m[2], "base64");
  const form = new FormData();
  form.append("attachment", new Blob([bytes], { type: m[1] }), fileName);
  const res = await fetch(CLICKUP_BASE + "/task/" + taskId + "/attachment", {
    method: "POST",
    headers: { Authorization: token },
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error("Attachment upload failed: " + res.status + " " + errText);
  }
  return res.json();
}

async function setField(token, taskId, fieldId, value) {
  const res = await fetch(CLICKUP_BASE + "/task/" + taskId + "/field/" + fieldId, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ value: value }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error("Field update failed: " + res.status + " " + errText);
  }
  return res.json();
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
