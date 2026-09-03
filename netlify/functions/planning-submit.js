/**
 * Ampersound Media Group — Planning Submit
 * Receives song requests and timeline data from client portal.
 * Posts formatted comments on the matching task in ClickUp.
 *
 * Searches BOTH Pipeline and Agreements lists.
 * Handles both nested (specialMoments) and flat data formats.
 *
 * Env vars:
 *   CLICKUP_API_TOKEN
 *   PIPELINE_LIST_ID - 901418578191
 *   AGREEMENTS_LIST_ID - 901418268145
 */

const CLICKUP_BASE = "https://api.clickup.com/api/v2";

// Email fields across both lists
const EMAIL_FIELD_IDS = [
  "a32a6928-ba34-4d2f-8792-d2f63d739f90",  // Email Address (Pipeline)
  "6662e48d-f76c-4bf4-aa23-1d56037dd61c",  // Email (folder-level)
  "3f38f15e-6aa4-4481-9365-d4a911d68195"   // Client Email (Agreements)
];

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
  const PIPELINE_ID = process.env.PIPELINE_LIST_ID || "901418578191";
  const AGREEMENTS_ID = process.env.AGREEMENTS_LIST_ID || "901418268145";

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

  const { type, email, emails, client, data } = payload;

  if (!type || (!email && !emails) || !data) {
    return { statusCode: 400, headers, body: "Missing required fields" };
  }

  const emailsToMatch = (emails || [email]).map(function(e) { return e.trim().toLowerCase(); });

  console.log("Planning submit:", type, "from", emailsToMatch.join(", "));

  try {
    // Search both lists for matching task
    const task = await findTaskInLists(TOKEN, [AGREEMENTS_ID, PIPELINE_ID], emailsToMatch);

    if (!task) {
      console.log("No task found for:", emailsToMatch.join(", "));
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, message: "No matching task" })
      };
    }

    console.log("Found task:", task.id, task.name, "in list:", task.list ? task.list.id : "unknown");

    let comment = "";

    if (type === "songs") {
      comment = formatSongComment(normalizeeSongData(data), client);
    } else if (type === "timeline") {
      comment = formatTimelineComment(normalizeTimelineData(data), client);
    } else {
      return { statusCode: 400, headers, body: "Invalid type" };
    }

    // Post comment on the task
    await postComment(TOKEN, task.id, comment);
    console.log("Comment posted on task:", task.id);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ok: true, type, taskId: task.id }),
    };
  } catch (err) {
    console.error("Planning submit error:", err.message, err.stack);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// --- Normalizers: handle both portal data formats ---

function normalizeeSongData(data) {
  // Portal sends nested: data.specialMoments.firstDance
  // Old format sends flat: data.firstDance
  var sm = data.specialMoments || {};
  return {
    aisle: sm.aisle || data.aisle || data.brideProcessional || "",
    bridalParty: sm.bridalParty || data.bridalParty || "",
    recessional: sm.recessional || data.recessional || "",
    firstDance: sm.firstDance || data.firstDance || "",
    privateLast: sm.privateLast || data.lastDance || data.privateLast || "",
    fatherDaughter: sm.fatherDaughter || data.fatherDaughter || "",
    motherSon: sm.motherSon || data.motherSon || "",
    bouquet: sm.bouquet || data.bouquet || data.tossSong || "",
    exit: sm.exit || data.exit || "",
    karaoke: sm.karaoke || data.karaoke || "",
    mustPlay: data.mustPlay || [],
    dontPlay: data.dontPlay || [],
    playlist: data.playlist || data.playlistLink || "",
    vibe: data.vibe || "",
    guestRequests: data.guestRequests || data.requests || "",
    notes: data.notes || ""
  };
}

function normalizeTimelineData(data) {
  // Portal sends: data.moments  |  Old format: data.timeline
  return {
    moments: data.moments || data.timeline || [],
    notes: data.notes || ""
  };
}

// --- Formatters ---

function formatSongComment(d, client) {
  var lines = [];
  lines.push("\ud83c\udfb5 **Song Preferences** submitted by " + (client || "client"));
  lines.push("");
  lines.push("**Special Moments:**");
  if (d.aisle) lines.push("  Aisle Walk / Processional: " + d.aisle);
  if (d.bridalParty) lines.push("  Bridal Party Processional: " + d.bridalParty);
  if (d.recessional) lines.push("  Recessional: " + d.recessional);
  if (d.firstDance) lines.push("  First Dance: " + d.firstDance);
  if (d.privateLast) lines.push("  Private Last Dance: " + d.privateLast);
  if (d.fatherDaughter) lines.push("  Father/Daughter: " + d.fatherDaughter);
  if (d.motherSon) lines.push("  Mother/Son: " + d.motherSon);
  if (d.bouquet) lines.push("  Bouquet/Garter Toss: " + d.bouquet);
  if (d.exit) lines.push("  Exit / Send-Off: " + d.exit);
  if (d.karaoke) lines.push("  Karaoke Pick: " + d.karaoke);

  if (d.playlist) {
    lines.push("");
    lines.push("**Playlist Link:** " + d.playlist);
  }

  if (d.mustPlay && d.mustPlay.length > 0) {
    lines.push("");
    lines.push("**Must-Play:**");
    d.mustPlay.forEach(function(s) { if (s) lines.push("- " + s); });
  }

  if (d.dontPlay && d.dontPlay.length > 0) {
    lines.push("");
    lines.push("**Do-Not-Play:**");
    d.dontPlay.forEach(function(s) { if (s) lines.push("- " + s); });
  }

  if (d.vibe) {
    lines.push("");
    lines.push("**Vibe/Volume:** " + d.vibe);
  }

  if (d.guestRequests) {
    lines.push("**Guest Requests:** " + d.guestRequests);
  }

  if (d.notes) {
    lines.push("");
    lines.push("**Additional Notes:** " + d.notes);
  }

  lines.push("");
  lines.push("---");
  lines.push("Submitted: " + new Date().toLocaleString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }));

  return lines.join("\n");
}

function formatTimelineComment(d, client) {
  var lines = [];
  lines.push("\ud83d\udccb **Day-Of Timeline** submitted by " + (client || "client"));
  lines.push("");
  lines.push("| Time | Event |");
  lines.push("| --- | --- |");

  if (d.moments && d.moments.length > 0) {
    d.moments.forEach(function(item) {
      if (item.time || item.event) {
        lines.push("| " + (item.time || "TBD") + " | " + (item.event || "") + " |");
      }
    });
  }

  if (d.notes) {
    lines.push("");
    lines.push("**Notes:** " + d.notes);
  }

  lines.push("");
  lines.push("---");
  lines.push("Submitted: " + new Date().toLocaleString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }));

  return lines.join("\n");
}

// --- ClickUp Helpers ---

async function findTaskInLists(token, listIds, emails) {
  for (var i = 0; i < listIds.length; i++) {
    var listId = listIds[i];
    console.log("Searching list:", listId);
    var res = await fetch(CLICKUP_BASE + "/list/" + listId + "/task?include_closed=true&subtasks=false", {
      headers: { Authorization: token },
    });
    if (!res.ok) {
      console.error("List fetch failed:", listId, res.status);
      continue;
    }
    var data = await res.json();
    console.log("Tasks in list", listId + ":", data.tasks ? data.tasks.length : 0);

    var match = data.tasks.find(function(t) {
      // Check all email custom fields (case-insensitive)
      var fieldMatch = t.custom_fields && t.custom_fields.some(function(f) {
        if (!EMAIL_FIELD_IDS.includes(f.id) || !f.value) return false;
        var fieldVal = (typeof f.value === "string" ? f.value : "").toLowerCase();
        return emails.some(function(e) { return e === fieldVal; });
      });
      if (fieldMatch) return true;

      // Fallback: check description
      if (t.description) {
        var desc = t.description.toLowerCase();
        return emails.some(function(e) { return desc.indexOf(e) !== -1; });
      }
      return false;
    });

    if (match) return match;
  }
  return null;
}

async function postComment(token, taskId, text) {
  var res = await fetch(CLICKUP_BASE + "/task/" + taskId + "/comment", {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ comment_text: text }),
  });
  if (!res.ok) {
    var errText = await res.text();
    console.error("Comment failed:", res.status, errText);
    throw new Error("Comment failed: " + res.status);
  }
}
