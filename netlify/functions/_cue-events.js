'use strict';
// Server-side event configuration. Increment a vendor revision to revoke its old link.
// Vendor contact (phone, email, instagram, website, person) shows on every vendor page in the event
// team list. Load only what the vendor agreed to share; share: false hides a vendor's details.
// Real events set agreementTaskId so the DJ sees the couple's songs live from their portal answers;
// each moment lists the portal song keys it plays (aisle, firstDance, exit, ...). sampleSongs is demo-only.
const t = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const EVENTS = {
  demo: {
    name: 'Ava & Marcus', kind: 'wedding', date: '2027-06-12', dateLabel: 'Sat, Jun 12, 2027',
    venue: 'Red Butte Garden, SLC', tz: 'America/Denver', taskId: '86bcw638q',
    coordinator: { name: 'Afia', phone: '+15127994646', phoneLabel: '(512) 799-4646' },
    lanes: ['Run of show'],
    vendors: [
      { id: 'amg', name: 'Ampersound Media Group', role: 'DJ + MC', contact: 'afia@ampersoundmediagroup.com', arrival: t('15:30'), rev: 1 },
      { id: 'photo', name: 'Lumen & Lace Photo', role: 'Photography', person: 'Maya', phone: '(801) 555-0142', email: 'hello@lumenlace.example', instagram: 'lumenandlace', arrival: t('13:30'), rev: 2 },
      { id: 'video', name: 'Fieldnote Films', role: 'Videography', person: 'Theo', phone: '(801) 555-0157', instagram: 'fieldnotefilms', arrival: t('14:00'), rev: 1 },
      { id: 'florals', name: 'Wild Sage Florals', role: 'Florals', person: 'Rosa', phone: '(801) 555-0163', arrival: t('13:00'), rev: 1 },
      { id: 'catering', name: 'Copper Table Catering', role: 'Catering', person: 'Andre', phone: '(801) 555-0178', email: 'events@coppertable.example', arrival: t('15:00'), rev: 1 },
      { id: 'hmua', name: 'Glow Studio', role: 'Hair + makeup', instagram: 'glowstudio.slc', arrival: t('10:30'), rev: 1 },
      { id: 'venue', name: 'Red Butte Events', role: 'Venue lead', person: 'Kim', phone: '(801) 555-0181', arrival: t('12:00'), rev: 1 },
      { id: 'officiant', name: 'Rev. Dana Ellis', role: 'Officiant', share: false, phone: '(801) 555-0199', arrival: t('16:15'), rev: 1 },
    ],
    moments: [
      { id: 'm01', time: t('14:00'), dur: 90, title: 'Hair + makeup final touches', location: 'Bridal suite', vendors: ['hmua', 'photo'] },
      { id: 'm02', time: t('15:30'), dur: 30, title: 'First look + portraits', location: 'Garden terrace', vendors: ['photo', 'video'] },
      { id: 'm03', time: t('16:00'), dur: 30, title: 'Ceremony flip + florals', location: 'Ceremony lawn', vendors: ['florals', 'venue'] },
      { id: 'm04', time: t('16:30'), dur: 30, title: 'Guest arrival, prelude music', location: 'Ceremony lawn', vendors: ['amg', 'venue'], songs: ['prelude'] },
      { id: 'm05', time: t('17:00'), dur: 30, title: 'Ceremony', location: 'Ceremony lawn', vendors: ['officiant', 'amg', 'photo', 'video'], songs: ['bridalParty', 'aisle', 'recessional'] },
      { id: 'm06', time: t('17:30'), dur: 60, title: 'Cocktail hour', location: 'Terrace', vendors: ['catering', 'amg', 'photo'], songs: ['cocktail'] },
      { id: 'm07', time: t('18:30'), dur: 15, title: 'Grand entrance', location: 'Ballroom', vendors: ['amg', 'photo', 'video'], songs: ['entrance'] },
      { id: 'm08', time: t('18:45'), dur: 10, title: 'First dance', location: 'Ballroom', vendors: ['amg', 'photo', 'video'], songs: ['firstDance'] },
      { id: 'm09', time: t('18:55'), dur: 45, title: 'Dinner service', location: 'Ballroom', vendors: ['catering', 'amg'] },
      { id: 'm10', time: t('19:40'), dur: 20, title: 'Toasts', location: 'Ballroom', vendors: ['amg', 'video'] },
      { id: 'm11', time: t('20:00'), dur: 10, title: 'Cake cutting', location: 'Ballroom', vendors: ['catering', 'photo'], songs: ['cake'] },
      { id: 'm12', time: t('20:10'), dur: 110, title: 'Open dancing', location: 'Ballroom', vendors: ['amg', 'photo'] },
      { id: 'm13', time: t('22:00'), dur: 10, title: 'Sparkler exit', location: 'Front drive', vendors: ['venue', 'photo', 'video'], songs: ['exit'] },
      { id: 'm14', time: t('22:10'), dur: 50, title: 'Load out', location: 'Ballroom', vendors: ['amg', 'florals', 'catering', 'venue'] },
    ],
    sampleSongs: {
      moments: { prelude: 'Can\'t Help Falling in Love (strings) · Vitamin String Quartet', bridalParty: 'A Thousand Years · Christina Perri', aisle: 'At Last · Etta James', recessional: 'Signed, Sealed, Delivered · Stevie Wonder', cocktail: 'Sunday-brunch soul mix, low volume', entrance: 'Crazy in Love · Beyoncé', firstDance: 'Adorn · Miguel', cake: 'Sugar · Maroon 5', exit: 'September · Earth, Wind & Fire' },
      labels: { prelude: 'Prelude', bridalParty: 'Bridal Party Processional', aisle: 'Aisle Walk / Processional', recessional: 'Recessional', cocktail: 'Cocktail hour', entrance: 'Grand Entrance', firstDance: 'First Dance', cake: 'Cake Cutting', exit: 'Exit / Send-Off' },
      mustPlay: ['Before I Let Go · Frankie Beverly & Maze', 'Golden Hour · JVKE', 'Love on Top · Beyoncé'],
      dontPlay: ['Macarena', 'Chicken Dance'],
      playlist: 'https://open.spotify.com/search/wedding%20reception',
      vibe: 'Mixed: classics early, dance floor after dinner',
      notes: 'Sample songs for the demo only.',
    },
  },
};
module.exports = { EVENTS };
