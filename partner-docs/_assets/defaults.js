/* Shared defaults for Ampersound client portals.
 *
 * The vendor list, the wedding copy, the special-moment fields, and the
 * standard agreement are the same on every wedding portal, so they live here
 * once instead of being copied into each page. A client page passes only what
 * is actually specific to that client and calls AMG.wedding() to get a
 * complete PORTAL record.
 */

/* Signature export. The pad draws light ink on a transparent canvas so it reads
 * on the dark portal, which makes the saved PNG almost invisible on white in
 * ClickUp. When the signature canvas (#sig) is exported, recolor the strokes to
 * dark ink on a white background. Every other canvas exports unchanged.
 */
(function () {
  if (typeof HTMLCanvasElement === "undefined") return;
  var original = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function () {
    if (this.id !== "sig") return original.apply(this, arguments);
    try {
      var copy = document.createElement("canvas");
      copy.width = this.width;
      copy.height = this.height;
      var ctx = copy.getContext("2d");
      ctx.drawImage(this, 0, 0);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = "#14161a";
      ctx.fillRect(0, 0, copy.width, copy.height);
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, copy.width, copy.height);
      return original.call(copy, "image/png");
    } catch (e) {
      return original.apply(this, arguments);
    }
  };
})();

window.AMG = (function () {
  var VENDORS = [
    { group: "Beverage & Bar", items: [
      { name: "Indigo Reimagined", role: "Craft bar and beverage service",
        blurb: "Signature cocktail programs and full bar service built around the couple's story.",
        links: [{ label: "indigoreimagined.com", href: "https://indigoreimagined.com" },
                { label: "(801) 654-8571", href: "tel:+18016548571" }] }] },
    { group: "Catering", items: [
      { name: "Killa Nikkei", role: "Japanese-Peruvian catering \u00b7 Sebastian Consiglieri",
        blurb: "Nikkei cuisine that gives a reception a genuine centerpiece.",
        links: [{ label: "killanikkei.com", href: "https://killanikkei.com" },
                { label: "(801) 366-6070", href: "tel:+18013666070" }] }] },
  ];

  var WEDDING_LABELS = {
    songs: "Songs", timeline: "Timeline",
    songsHeading: "Song preferences", songsNoun: "song list",
    songsIntro: "Fill in what you know and leave the rest blank. Nothing here is final until the wedding, and you can send updates as many times as you like.",
    momentsHeading: "Special moments", requestsHeading: "Guest requests",
    songNotesPlaceholder: "Artists you love, moments you are picturing, people to keep off the mic",
    timelineHeading: "Day-of timeline", timelineNoun: "timeline", momentNoun: "Moment",
    timelineIntro: "This is our draft. Move times, rewrite moments, delete what does not apply. We lock the final version two weeks out.",
    timelineNotesLabel: "Timeline notes",
    timelineNotesPlaceholder: "Transitions, people who need a heads up, anything the venue requires",
  };

  var WEDDING_VIBES = [
    ["mixed", "Conversational through dinner, energized on the dance floor"],
    ["low", "Keep it low and conversational all night"],
    ["nopref", "No preference, read the room and call it"],
  ];

  var WEDDING_REQUESTS = [
    ["couple-first", "Take requests, but our list comes first"],
    ["none", "No guest requests"],
    ["open", "Open requests, bring on the chaos"],
  ];

  // spec.moments lets a portal rename a field (garter toss) or add one
  // (karaoke) without restating the whole list.
  function momentFields(spec) {
    var f = [
      { key: "aisle", label: "Aisle Walk / Processional", hint: spec.aisleHint || "" },
      { key: "bridalParty", label: "Bridal Party Processional", hint: "" },
      { key: "recessional", label: "Recessional", hint: "First walk as newlyweds" },
      { key: "firstDance", label: "First Dance", hint: "" },
      { key: "fatherDaughter", label: "Father / Daughter Dance", hint: "" },
      { key: "motherSon", label: "Mother / Son Dance", hint: "" },
      { key: "bouquet", label: spec.bouquetLabel || "Bouquet Toss", hint: "" },
      { key: "privateLast", label: "Private Last Dance", hint: "Just the two of you, before the exit" },
      { key: "exit", label: "Exit / Send-Off", hint: spec.exitHint || "" },
    ];
    return f.concat(spec.extraMoments || []);
  }

  // One agreement for every wedding portal. Client pages pass agreementTerms
  // (their facts only); the clauses, order, and policy numbers stay identical.
  // Numbers are always written as numerals. {{total}}, {{deposit}},
  // {{balance}}, {{travel}}, and {{option}} are filled in by portal.js.
  function standardAgreement(t) {
    var rate = t.overtimeRate || 150;
    var c = [
      { title: "Parties", body: "This agreement is between Ampersound Media Group LLC, 26 S Rio Grande St, Suite 2072, Salt Lake City, UT 84101 (\"Ampersound\"), and " + t.client + " (\"Client\")." },
      { title: "Event Details", body: "Date: " + t.eventDateLong + ". Venue: " + t.venue + ". Coverage: " + t.start + " to " + t.end + ". Estimated guests: " + t.guests + "." },
      { title: "Services", body: "{{option}} (" + t.crew + "): " + t.scope + " All equipment, setup, and breakdown are included." },
      { title: "Compensation", body: "Total fee: {{total}}." + (t.discount ? " " + t.discount : "") + " Deposit: {{deposit}} (50%), due upon signing. Balance: {{balance}}, due " + t.balanceDue + " (14 days before the event)." },
      { title: "Deposit & Date Reservation", body: "The {{deposit}} deposit is non-refundable and reserves " + t.eventDateLong + " exclusively for Client. The date is confirmed once the deposit is received." },
      { title: "Payment Method", body: "Payment is accepted by card, bank transfer, or check. Card and bank payments are made through a secure Stripe link." },
      { title: "Travel", body: "Travel fee: {{travel}}." + (t.travelNote ? " " + t.travelNote : "") },
      { title: "Cancellation by Client", body: "60 or more days before the event: the deposit is retained and any balance paid is refunded. 30 to 59 days: 50% of the total fee is refunded and 50% is retained. 15 to 29 days: 25% is refunded and 75% is retained. 14 days or fewer: no refund; 100% is retained." },
      { title: "Cancellation by Ampersound", body: "If Ampersound must cancel due to an emergency or force majeure, 100% of all payments will be refunded within 7 business days." },
      { title: "Client Responsibilities", body: "Client will: provide 1 dedicated 20-amp circuit within 50 feet of each setup area; provide load-in access at least 90 minutes before the start time; send the final timeline, key moments, and music preferences at least 14 days before the event; name 1 day-of point of contact who can make real-time decisions; and share any venue restrictions (sound limits, curfews, equipment rules) at least 14 days before the event." },
      { title: "Ampersound Responsibilities", body: "Ampersound will: arrive at least 90 minutes before the contracted start time; provide all equipment for the selected package in professional working condition, with backup gear on site; honor Client's music requests and do-not-play list; dress to the formality of the event; and communicate proactively about any concerns or changes." },
      { title: "Equipment", body: "Ampersound provides professional-grade speakers, microphones, DJ controllers, cables, and stands sized to the venue and guest count. Client is responsible for damage to Ampersound equipment caused by guests, venue conditions, or negligence, billed at current market replacement value." },
      { title: "Timeline & Coordination", body: "Ampersound serves as MC and timeline lead on the event day. This does not include full-service wedding planning. The final run of show is locked 14 days before the event and shared with the venue and key vendors." },
      { title: "Overtime", body: "If the event runs past " + t.end + " and Ampersound is available, overtime is billed at $" + rate + " per hour, prorated in 30-minute increments, and must be approved by Client or the day-of contact." + (t.overtimeNote ? " " + t.overtimeNote : "") },
      { title: "Media & Content Release", body: "Client grants Ampersound permission to capture photos and video of the setup and performance, and to use them on Ampersound's website, social media, and marketing without private details. Client may opt out at any time in writing." },
      { title: "Liability", body: "Ampersound's total liability under this agreement will not exceed the total fee of {{total}}. Ampersound is not liable for venue issues (power outages, noise complaints, structural limits), weather or acts of nature, guest behavior or property damage caused by attendees, or delays caused by other vendors, venue staff, or timeline changes outside Ampersound's control. A certificate of liability insurance is available to the venue on request." },
      { title: "Force Majeure", body: "Neither party is liable for failure to perform due to circumstances beyond reasonable control, including natural disasters, severe weather, government actions, pandemic restrictions, civil unrest, or venue closures. Both parties will work in good faith to reschedule or issue an appropriate refund." },
    ];
    (t.special || []).forEach(function (s) { c.push(s); });
    c.push({ title: "Entire Agreement", body: "This document is the entire agreement between the parties. Any changes must be made in writing and agreed to by both parties. This agreement is governed by the laws of the State of Utah." });
    return {
      intro: t.intro || "This is the full agreement between Ampersound and " + t.client + ", with your numbers built in. If anything needs adjusting, we are open to that conversation.",
      clauses: c,
    };
  }

  // Proposal sections portal.js renders when present. These were previously
  // dropped here, so pages that defined them never showed them.
  var PROPOSAL_EXTRAS = ["agendaNeeds", "runOfShow", "runOfShowNote", "unbundled",
    "playbookIntro", "playbookLead", "playbook", "playbookClose"];

  function wedding(spec) {
    var fields = momentFields(spec);
    var seedMoments = {};
    fields.forEach(function (f) { seedMoments[f.key] = (spec.moments || {})[f.key] || ""; });
    var out = {
      slug: spec.slug,
      mode: spec.mode || "overview",
      client: spec.client,
      pricing: spec.pricing,
      labels: WEDDING_LABELS,
      momentFields: fields,
      vibes: WEDDING_VIBES,
      requests: WEDDING_REQUESTS,
      vendors: VENDORS,
      songSeed: {
        moments: seedMoments,
        mustPlay: spec.mustPlay || [""],
        dontPlay: spec.dontPlay || [""],
        playlist: "", vibe: "mixed", guestRequests: "couple-first",
        notes: spec.songNotes || "",
      },
      timelineSeed: { moments: spec.timeline, notes: spec.timelineNotes || "" },
      // Proposal-mode extras, ignored in overview mode.
      heard: spec.heard,
      chooserIntro: spec.chooserIntro,
      staffingOptions: spec.staffingOptions,
      nextStep: spec.nextStep,
      agreement: spec.agreementTerms ? standardAgreement(spec.agreementTerms) : spec.agreement,
      paymentLink: spec.paymentLink || "#",
      footnote: spec.footnote,
    };
    PROPOSAL_EXTRAS.forEach(function (k) { if (spec[k] !== undefined) out[k] = spec[k]; });
    return out;
  }

  return { vendors: VENDORS, weddingLabels: WEDDING_LABELS, wedding: wedding, standardAgreement: standardAgreement };
})();
