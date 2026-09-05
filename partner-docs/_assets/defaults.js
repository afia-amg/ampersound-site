/* Shared defaults for Ampersound client portals.
 *
 * The vendor list, the wedding copy, and the special-moment fields are the same
 * on every wedding portal, so they live here once instead of being copied into
 * each page. A client page passes only what is actually specific to that client
 * and calls AMG.wedding() to get a complete PORTAL record.
 */
window.AMG = (function () {
  var VENDORS = [
    { group: "Beverage & Bar", items: [
      { name: "Indigo Reimagined", role: "Craft bar and beverage service",
        blurb: "Signature cocktail programs and full bar service built around the couple's story.",
        links: [{ label: "indigoreimagined.com", href: "https://indigoreimagined.com" },
                { label: "(801) 654-8571", href: "tel:+18016548571" }] }] },
    { group: "Planning & Design", items: [
      { name: "Chris McKinley Event Design", role: "Full-service planning and design",
        blurb: "Design-led planning for weddings that need a strong visual point of view.",
        links: [{ label: "chrismckinleyevents.com", href: "https://chrismckinleyevents.com" },
                { label: "(225) 937-0304", href: "tel:+12259370304" }] },
      { name: "Liffcake Parties", role: "Planning and coordination \u00b7 Carla Lifferth",
        blurb: "Warm, detail-obsessed coordination. Great for day-of and partial planning.",
        links: [{ label: "liffcakeparties.com", href: "https://liffcakeparties.com" },
                { label: "liffcakeparties@gmail.com", href: "mailto:liffcakeparties@gmail.com" }] }] },
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

  function wedding(spec) {
    var fields = momentFields(spec);
    var seedMoments = {};
    fields.forEach(function (f) { seedMoments[f.key] = (spec.moments || {})[f.key] || ""; });
    return {
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
      agreement: spec.agreement,
      paymentLink: spec.paymentLink || "#",
      footnote: spec.footnote,
    };
  }

  return { vendors: VENDORS, weddingLabels: WEDDING_LABELS, wedding: wedding };
})();
