'use strict';
// Server-side event configuration. Increment a vendor revision to revoke its old link.
const t = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const EVENTS = {
  demo: {
    name: 'Ava & Marcus', kind: 'wedding', date: '2027-06-12', dateLabel: 'Sat, Jun 12, 2027',
    venue: 'Red Butte Garden, SLC', tz: 'America/Denver', taskId: '86bcw638q',
    coordinator: { name: 'Afia', phone: '+15127994646', phoneLabel: '(512) 799-4646' },
    lanes: ['Run of show'],
    vendors: [
      { id: 'amg', name: 'Ampersound Media Group', role: 'DJ + MC', contact: 'afia@ampersoundmediagroup.com', arrival: t('15:30'), rev: 1 },
      { id: 'photo', name: 'Lumen & Lace Photo', role: 'Photography', contact: '', arrival: t('13:30'), rev: 2 },
      { id: 'video', name: 'Fieldnote Films', role: 'Videography', contact: '', arrival: t('14:00'), rev: 1 },
      { id: 'florals', name: 'Wild Sage Florals', role: 'Florals', contact: '', arrival: t('13:00'), rev: 1 },
      { id: 'catering', name: 'Copper Table Catering', role: 'Catering', contact: '', arrival: t('15:00'), rev: 1 },
      { id: 'hmua', name: 'Glow Studio', role: 'Hair + makeup', contact: '', arrival: t('10:30'), rev: 1 },
      { id: 'venue', name: 'Red Butte Events', role: 'Venue lead', contact: '', arrival: t('12:00'), rev: 1 },
      { id: 'officiant', name: 'Rev. Dana Ellis', role: 'Officiant', contact: '', arrival: t('16:15'), rev: 1 },
    ],
    moments: [
      { id: 'm01', time: t('14:00'), dur: 90, title: 'Hair + makeup final touches', location: 'Bridal suite', vendors: ['hmua', 'photo'] },
      { id: 'm02', time: t('15:30'), dur: 30, title: 'First look + portraits', location: 'Garden terrace', vendors: ['photo', 'video'] },
      { id: 'm03', time: t('16:00'), dur: 30, title: 'Ceremony flip + florals', location: 'Ceremony lawn', vendors: ['florals', 'venue'] },
      { id: 'm04', time: t('16:30'), dur: 30, title: 'Guest arrival, prelude music', location: 'Ceremony lawn', vendors: ['amg', 'venue'] },
      { id: 'm05', time: t('17:00'), dur: 30, title: 'Ceremony', location: 'Ceremony lawn', vendors: ['officiant', 'amg', 'photo', 'video'] },
      { id: 'm06', time: t('17:30'), dur: 60, title: 'Cocktail hour', location: 'Terrace', vendors: ['catering', 'amg', 'photo'] },
      { id: 'm07', time: t('18:30'), dur: 15, title: 'Grand entrance', location: 'Ballroom', vendors: ['amg', 'photo', 'video'] },
      { id: 'm08', time: t('18:45'), dur: 10, title: 'First dance', location: 'Ballroom', vendors: ['amg', 'photo', 'video'] },
      { id: 'm09', time: t('18:55'), dur: 45, title: 'Dinner service', location: 'Ballroom', vendors: ['catering', 'amg'] },
      { id: 'm10', time: t('19:40'), dur: 20, title: 'Toasts', location: 'Ballroom', vendors: ['amg', 'video'] },
      { id: 'm11', time: t('20:00'), dur: 10, title: 'Cake cutting', location: 'Ballroom', vendors: ['catering', 'photo'] },
      { id: 'm12', time: t('20:10'), dur: 110, title: 'Open dancing', location: 'Ballroom', vendors: ['amg', 'photo'] },
      { id: 'm13', time: t('22:00'), dur: 10, title: 'Sparkler exit', location: 'Front drive', vendors: ['venue', 'photo', 'video'] },
      { id: 'm14', time: t('22:10'), dur: 50, title: 'Load out', location: 'Ballroom', vendors: ['amg', 'florals', 'catering', 'venue'] },
    ],
  },
};
module.exports = { EVENTS };
