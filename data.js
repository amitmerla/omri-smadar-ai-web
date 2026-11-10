// Baseline knowledge about Omri Smadar. Sourced from omrismadar.com and his YouTube channel (Nov 2026).
// The AI agent layers live web data on top of this at runtime (see agent.js).
window.OMRI = {
  // The deck plays this file when it exists; until then deck.js generates a stand-in groove.
  track: { src: 'audio/track.mp3', title: 'Omri Smadar' },

  events: [
    { date: '2026-11-12', title: 'Omri Smadar Live', venue: 'Barby', city: 'Tel Aviv', status: 'soldout', url: 'https://barby.co.il/show/5503' },
    { date: '2026-11-13', title: 'Omri Smadar Live', venue: 'Barby', city: 'Tel Aviv', status: 'soldout', url: 'https://barby.co.il/show/5504' },
    { date: '2026-11-28', title: 'DRIFT — Omri Smadar × Lior Tavori Dance Company', venue: 'Beit Tami', city: 'Tel Aviv', status: 'tickets', url: 'https://www.eventer.co.il/6004f' },
    { date: '2027-01-07', title: 'Omri Smadar Live', venue: 'Barby', city: 'Tel Aviv', status: 'tickets', url: 'https://barby.co.il/show/5570' },
    { date: '2027-01-08', title: 'Omri Smadar Live', venue: 'Barby', city: 'Tel Aviv', status: 'tickets', url: 'https://barby.co.il/show/5571' },
    { date: '2027-01-12', title: 'DJ Set — with Yulia Niko', venue: 'Jungle Experience', city: 'Koh Phangan, Thailand', status: 'tickets', url: 'https://megatix.in.th/events/omri-smadar-yulia-niko-at-jungle-experience-koh-phangan-12-january-tue' },
    { date: '2027-01-30', title: 'Melodeep Weekend — DJ Set', venue: 'Melodeep', city: 'Rio de Janeiro, Brazil', status: 'tickets', url: 'https://go-out.co/event/1792166207785' }
  ],

  euroTour: [
    { date: '2026-05-17', city: 'Budapest', venue: 'Akvárium Klub' },
    { date: '2026-05-18', city: 'London', venue: 'Fabric' },
    { date: '2026-05-19', city: 'Paris', venue: 'Bal Chavaux' },
    { date: '2026-05-21', city: 'Amsterdam', venue: 'Kaap' },
    { date: '2026-05-22', city: 'Berlin', venue: 'bi nuu' },
    { date: '2026-05-23', city: 'Ibiza', venue: 'Las Dalias' },
    { date: '2026-05-24', city: 'Barcelona', venue: 'Laut' }
  ],

  albums: [
    { title: 'Interplanetary Affair', note: 'Third album. Songwriting, live instruments and his first time singing. Marbled purple vinyl.', hue: 275, url: 'https://omrismadar.bandcamp.com/album/interplanetary-affair-lp' },
    { title: 'Collage 2.0', note: 'Second album. Double vinyl.', hue: 18, url: 'https://omrismadar.bandcamp.com/album/collage-20' },
    { title: 'Collage', note: 'Debut album. An electronic tribute to timeless Israeli music.', hue: 195, url: 'https://omrismadar.bandcamp.com/album/collage-an-electronic-tribute-to-timeless-israeli-music' }
  ],

  journey: [
    { tag: 'Origin', title: 'Maagan Michael', text: 'Born in a kibbutz on the Mediterranean shore.' },
    { tag: 'Age 8', title: 'A second-hand Yamaha', text: 'A birthday synth starts everything. An 88-key piano follows.' },
    { tag: 'Age 13', title: 'Silicon Pauker', text: 'A high school rock band, and a guitar.' },
    { tag: 'Record shops', title: 'Metallica kid, Prodigy disciple', text: 'Electronic music takes over.' },
    { tag: 'Age 17', title: 'First DJ gig', text: 'The booth becomes home.' },
    { tag: 'Sound system', title: 'Abuya', text: 'Founds Abuya Sound System with Itay Tzur. MC name: Smadicriss. First trip to Jamaica.' },
    { tag: 'School', title: 'Jazz and classical', text: 'Composer by training. House and disco by night.' },
    { tag: 'Debut', title: 'Collage', text: 'His own studio, a first EP deal with a major label, and the debut album.' },
    { tag: 'Live band', title: '10,000 people', text: 'The live electronic band debuts at a festival.' },
    { tag: 'Now', title: 'Interplanetary Affair', text: 'Third album, and the first time he sings.' }
  ],

  clips: [
    ['nX74r9DbG6k', 'Omri Smadar × The Witches — Ad Haoneg Haba', '13K', '1 month ago'],
    ['LMf_22-pzLk', 'Omri Smadar × Aviv Geffen — Shir Hasmartutim (Live, Yarkon Park)', '', ''],
    ['n861vcGZFGk', 'Adama (Live) ft. Nona Choir', '70K', '7 months ago'],
    ['yEVWdv-0B40', 'Roundabout (Live) feat. Megaphonim', '298K', '8 months ago'],
    ['qqNMB4u4C8Q', 'Just A Drop ft. Dafna Shilon (Official Video)', '1.5K', '9 months ago'],
    ['or1gxX3zzb8', 'Omri Smadar × Kayma — HEAR ME OUT (Official Video)', '190K', '1 year ago'],
    ['4E_bvX0wVJc', 'Omri Smadar & Ofer Bymel — Interplanetary Affair', '25K', '1 year ago'],
    ['cVrwpAySu8Y', 'Lose Your Soul — Live at Shuni Amphitheater', '713K', '1 year ago'],
    ['mhgCfnFHdWo', 'Omri Smadar & Jenia Tarsol — Lose Your Soul (feat. Nona Choir)', '499K', '1 year ago'],
    ['d634Fcv5SAc', 'Circumstance feat. Berry Sakharof', '17K', '1 year ago'],
    ['9qzTSpaQw2c', 'Live at Masada (Sunrise Concert)', '475K', '1 year ago'],
    ['RlvturwZ5Rs', 'Ir Shel Kaitz (Live) feat. Berry Sakharof', '66K', '2 years ago'],
    ['x2fIXtbIsC8', 'Epilog / Haboker', '26K', '3 years ago'],
    ['m0VAz65pZcA', 'Gidi Gov — Hakol Patuach (Omri Smadar Remix)', '19K', '3 years ago'],
    ['svRJa0Qx_ic', 'Yitzhak Klepter — Dimyon Hofshy (Omri Smadar Remix)', '237K', '3 years ago'],
    ['qt07XPz2cXU', 'Berry Sakharof & Dudu Tassa — Ya Ba La (Omri Smadar Remix)', '41K', '3 years ago'],
    ['kUeXvzQkHWk', 'Atuf (feat. Rita)', '17K', '3 years ago'],
    ['_ZQJt5Re8LE', 'Yamin Smoll (Omri Smadar Remix)', '3.3K', '3 years ago'],
    ['hcUlakXRakw', 'Micha Shitrit — Inti Omri (Omri Smadar Remix)', '21K', '3 years ago'],
    ['gyuM7sCp9ks', 'Shelo Yigamer', '5.6K', '3 years ago'],
    ['cwJtpusMXak', 'Einstein & Klepter — Shavir (Omri Smadar Remix)', '49K', '3 years ago'],
    ['DJ7-mg-_lC8', 'Ethnix — Ketrune Masala (Omri Smadar Remix)', '56K', '3 years ago'],
    ['Bh_JA6dRIOo', 'Eize Boker feat. Zehava Ben (Club Mix)', '20K', '3 years ago'],
    ['yPFVRN3DPsA', 'Eize Boker feat. Zehava Ben (Radio Version)', '30K', '3 years ago'],
    ['Mm9iNWzQrsg', 'Omri Smadar & Hakol Over Habibi — Layla (Remix)', '41K', '3 years ago'],
    ['KKLtVCIFRG0', 'Live at National Park', '51K', '3 years ago'],
    ['8Z-kTvvH2Q4', 'Ani Cham feat. Megaphonim (Live from The National Park)', '43K', '3 years ago'],
    ['0d8O_NCUeN8', 'Live @ Barby 18/8/22', '2.1K', '4 years ago'],
    ['bFZiX54PA3c', 'En Safek She feat. Fortis (Vocal Mix)', '55K', '6 years ago'],
    ['tE21mKKYvyA', 'Tamuz — Deeper, Bluer (Omri Smadar Remix)', '33K', '6 years ago']
  ].map(([id, title, views, age]) => ({ id, title, views, age })),

  links: {
    Instagram: 'https://www.instagram.com/omri_smadar/',
    YouTube: 'https://www.youtube.com/@OmriSmadar',
    Bandcamp: 'https://omrismadar.bandcamp.com/',
    Beatport: 'https://www.beatport.com/artist/omri-smadar/617006',
    Facebook: 'https://www.facebook.com/OmriSmadarOfficial/'
  },

  contact: {
    booking: { label: 'Booking', phone: '+972 54-433-9990', whatsapp: 'https://api.whatsapp.com/send?phone=972544339990' },
    management: { label: 'Management', name: 'Guy Dreifuss', phone: '+972 54-468-0603' }
  }
};
