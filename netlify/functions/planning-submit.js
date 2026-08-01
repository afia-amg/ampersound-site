/**
 * Ampersound Media Group — Planning Submit
 * Receives song requests and timeline data from client portal.
 * Posts formatted comments on the matching Pipeline task in ClickUp.
 *
 * Env vars:
 *   CLICKUP_API_TOKEN
 *   PIPELINE_LIST_ID - 901418578191 (new consolidated Pipeline)
 */

const CLICKUP_BASE = "https://api.clickup.com/api/v2";
const EMAIL_FIELD_ID = "a32a6928-ba34-4d2f-8792-d2f63d739f90";

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
  const LIST_ID = process.env.PIPELINE_LIST_ID || "901418578191";

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

  const { type, email, client, data } = payload;

  if (!type || !email || !data) {
    return { statusCode: 400, headers, body: "Missing required fields" };
  }

  try {
    // Find the Pipeline task by email
    const task = await findTaskByEmail(TOKEN, LIST_ID, email);

    if (!task) {
      console.log(`No task found for: ${email}`);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, message: "No matching task" })
      };
    }

    let comment = "";

    if (type === "songs") {
      comment = formatSongComment(data, client);
    } else if (type === "timeline") {
      comment = formatTimelineComment(data, client);
    } else {
      return { statusCode: 400, headers, body: "Invalid type" };
    }

    // Post comment on the task
    await postComment(TOKEN, task.id, comment);

    // Also update custom fields if song data
    if (type === "songs") {
      await updateSongFields(TOKEN, task.id, data);
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ok: true, type, taskId: task.id }),
    };
  } catch (err) {
    console.error("Planning submit error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// --- Formatters ---

function formatSongComment(data, client) {
  let lines = [];
  lines.push(`\ud83c\udfb5 **Song Requests** submitted by ${client}`);
  lines.push("");

  if (data.firstDance) lines.push(`**First Dance:** ${data.firstDance}`);
  if (data.lastDance) lines.push(`**Private Last Dance:** ${data.lastDance}`);
  if (data.groomEntrance) lines.push(`**Groom Entrance:** ${data.groomEntrance}`);
  if (data.brideProcessional) lines.push(`**Bride Processional:** ${data.brideProcessional}`);
  if (data.fatherDaughter) lines.push(`**Father/Daughter:** ${data.fatherDaughter}`);
  if (data.motherSon) lines.push(`**Mother/Son:** ${data.motherSon}`);
  if (data.tossSong) lines.push(`**Bouquet/Garter Toss:** ${data.tossSong}`);

  if (data.mustPlay && data.mustPlay.length > 0) {
    lines.push("");
    lines.push("**Must-Play:**");
    data.mustPlay.forEach(function(s) { lines.push(`- ${s}`); });
  }

  if (data.dontPlay && data.dontPlay.length > 0) {
    lines.push("");
    lines.push("**Do-Not-Play:**");
    data.dontPlay.forEach(function(s) { lines.push(`- ${s}`); });
  }

  if (data.vibe) {
    lines.push("");
    lines.push(`**Energy Preference:** ${data.vibe}`);
  }

  if (data.notes) {
    lines.push("");
    lines.push(`**Notes:** ${data.notes}`);
  }

  return lines.join("\n");
}

function formatTimelineComment(data, client) {
  let lines = [];
  lines.push(`\ud83d\udccb **Day-Of Timeline** submitted by ${client}`);
  lines.push("");
  lines.push("| Time | Event |");
  lines.push("| --- | --- |");

  if (data.timeline && data.timeline.length > 0) {
    data.timeline.forEach(function(item) {
      lines.push(`| ${item.time || "TBD"} | ${item.event || ""} |`);
    });
  }

  if (data.notes) {
    lines.push("");
    lines.push(`**Notes:** ${data.notes}`);
  }

  return lines.join("\n");
}

// --- ClickUp Helpers ---

async function findTaskByEmail(token, listId, email) {
  const res = await fetch(`${CLICKUP_BASE}/list/${listId}/task?include_closed=false`, {
    headers: { Authorization: token },
  });
  if (!res.ok) throw new Error(`ClickUp API: ${res.status}`);
  const data = await res.json();

  return data.tasks.find((t) =>
    t.custom_fields?.some(
      (f) => f.id === EMAIL_FIELD_ID && f.value === email
    )
  ) || null;
}

async function postComment(token, taskId, text) {
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}/comment`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ comment_text: text }),
  });
  if (!res.ok) console.error("Comment post failed:", res.status);
}

async function updateSongFields(token, taskId, data) {
  // Update Must-Play field (f6f085c8-6d03-4b29-88ce-2c005d68b91f)
  // Update Do-Not-Play field (a64d3333-7c86-4d16-8967-f8e6a569ac17)
  const fields = [];

  if (data.mustPlay && data.mustPlay.length > 0) {
    const mustPlayText = data.mustPlay.join("\n");
    if (data.firstDance) fields.push({ id: "f6f085c8-6d03-4b29-88ce-2c005d68b91f", value: `First Dance: ${data.firstDance}\n${mustPlayText}` });
    else fields.push({ id: "f6f085c8-6d03-4b29-88ce-2c005d68b91f", value: mustPlayText });
  } else if (data.firstDance) {
    fields.push({ id: "f6f085c8-6d03-4b29-88ce-2c005d68b91f", value: `First Dance: ${data.firstDance}` });
  }

  if (data.dontPlay && data.dontPlay.length > 0) {
    fields.push({ id: "a64d3333-7c86-4d16-8967-f8e6a569ac17", value: data.dontPlay.join("\n") });
  }

  if (fields.length === 0) return;

  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}`, {
    method: "PUT",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ custom_fields: fields }),
  });
  if (!res.ok) console.error("Field update failed:", res.status);
}
