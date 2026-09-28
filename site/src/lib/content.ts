// ============================================================
// Yanchan Produced — content data layer
// Swap this for a headless CMS (Sanity/Payload) in production.
// ============================================================

export const SPOTIFY_ARTIST =
  "https://open.spotify.com/artist/4GKSZvPRVHCR8TrVVWu9HH";

export const SOCIALS = [
  { label: "Instagram", href: "https://www.instagram.com/yanchanproduced/" },
  { label: "TikTok", href: "https://www.tiktok.com/@yanchanproduced" },
  {
    label: "Spotify",
    href: "https://open.spotify.com/artist/4GKSZvPRVHCR8TrVVWu9HH",
  },
  { label: "YouTube", href: "https://www.youtube.com/@yanchanproduced" },
  { label: "Kick", href: "https://kick.com/yanchanproduced" },
  { label: "Beatstars", href: "https://yanchanproduced.beatstars.com/" },
] as const;

// Verified live 2026-07-20 (Instagram · Spotify · YouTube) — source of record is
// the v6 investor deck. Update both together.
export const STATS = [
  { value: "12M+", label: "Spotify streams" },
  { value: "197K", label: "Monthly listeners" },
  { value: "15M+", label: "Views on one beat video" },
  { value: "800K+", label: "Reels made with his sound" },
];

/** Secondary proof points, same verification pass. */
export const REACH = [
  { value: "293K+", label: "Combined following" },
  { value: "120+", label: "Production credits" },
  { value: "6", label: "Countries toured" },
];

export const PRESS = [
  "Rolling Stone India",
  "Complex",
  "GQ India",
  "Vogue India",
  "CBC",
  "Homegrown",
  "NOW Toronto",
  "News18",
];

export type PressBlock =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "quote"; text: string; cite?: string };

export type PressArticle = {
  slug: string;
  outlet: string;
  title: string;
  deck: string;
  category: string;
  date: string; // ISO
  readMins: number;
  image: string;
  imageCredit?: string;
  featured?: boolean;
  externalUrl?: string;
  body: PressBlock[];
};

export const PRESS_ARTICLES: PressArticle[] = [
  {
    slug: "rolling-stone-india-mridangam-weapon",
    outlet: "Rolling Stone India",
    title: "How Yanchan Turned the Mridangam Into a Global Hip-Hop Weapon",
    deck: "With Mrithangam Raps, the Scarborough producer placed a 2,000-year-old Carnatic drum at the centre of modern rap, and built a category of one.",
    category: "Feature",
    date: "2026-04-22",
    readMins: 7,
    image: "/assets/press/yanchan-studio-mridangam.jpg",
    imageCredit: "Yanchan Produced",
    featured: true,
    externalUrl: "https://rollingstoneindia.com/",
    body: [
      {
        type: "p",
        text: "Yanchan Rajmohan was six years old when he first sat behind a mridangam. He didn't know it yet, but the double-headed Carnatic drum (its left face tuned low and breathing, its right face cracking like a snare) would become the most recognisable sound in a catalogue now past 12 million streams.",
      },
      {
        type: "p",
        text: "Two decades later, the Canadian-Tamil producer is the architect of Mrithangam Raps, the viral series that placed the sacred rhythms of South Indian classical music dead-centre in trap, drill and R&B. The premise is deceptively simple: take an instrument built for temples and concert halls, and let it trade bars with a rapper. The result sounds like nothing else.",
      },
      {
        type: "quote",
        text: "I'm not sampling the mridangam. I'm playing it, live, into the beat. That's the whole point. The tradition has to breathe.",
        cite: "Yanchan",
      },
      {
        type: "p",
        text: "Raised in Scarborough, Ontario (the dense, diasporic east end of Toronto that he reps in nearly every release), Yanchan grew up between two musical worlds. On one side, the strict discipline of Carnatic percussion, which made him the youngest person in Canada to perform a Mridangam Arangetram. On the other, the hip-hop pouring out of the city around him.",
      },
      { type: "h", text: "A category of one" },
      {
        type: "p",
        text: "What makes the work land isn't novelty. It's craft. Yanchan is a trained mixing engineer and vocalist as well as a drummer, and his beat tapes (The India, The Scarborough, The Vancouver) treat the mridangam not as a garnish but as the lead voice. The percussion answers the rapper; the rapper answers the percussion. Call and response, tradition and the street, captured live.",
      },
      {
        type: "p",
        text: "As co-owner of Emtee Music Group, a boutique label and artist-development firm, he's now focused on something bigger than a single viral moment: building infrastructure for the next generation of South Indian artists, and bridging the gap between South India and North America. Heart, passion, certainty: the mantra he repeats like a metronome.",
      },
    ],
  },
  {
    slug: "complex-scarborough-bridge",
    outlet: "Complex",
    title:
      "Scarborough's Yanchan Is Building a Bridge Between Carnatic Music and Trap",
    deck: "The producer behind one of the most distinct sounds in the diaspora on the 416, the 808, and why he refuses to sample his own drum.",
    category: "Interview",
    date: "2026-03-15",
    readMins: 6,
    image: "/assets/hero-artist.jpg",
    imageCredit: "Yanchan Produced",
    externalUrl: "https://www.complex.com/",
    body: [
      {
        type: "p",
        text: "There's a moment in almost every Yanchan record where you can't tell whether you're hearing a drum machine or a human hand. That ambiguity is the point. The Scarborough producer has spent his career collapsing the distance between the mridangam (the South Indian hand drum he's played since childhood) and the 808s that define North American rap.",
      },
      {
        type: "p",
        text: '"Where the mridangam meets the 808," is how he describes it, and it\'s not a marketing line so much as a working method. Every percussion sound on a Yanchan beat is performed live, never pulled from a library.',
      },
      {
        type: "quote",
        text: "Scarborough taught me you can hold two things at once. Tamil at home, hip-hop on the bus. I never had to choose, so the music doesn't either.",
      },
      {
        type: "p",
        text: "That refusal to choose runs through everything: the collaborative catalogue with rapper SVDP, the features that range from Russ to Shruti Haasan, the beat tapes that have become a signature series. It also runs through the merch and the visuals: collegiate 416 lettering, the mridangam rendered like graffiti, Tamil syllabary wrapped around an 808.",
      },
      {
        type: "p",
        text: 'Yanchan is quick to point out he\'s not the first to fuse these worlds, but he may be the first to do it at this scale, with this level of fidelity to the source. "If I\'m going to put our music in front of millions of people," he says, "it has to be real. The drum has to be real."',
      },
    ],
  },
  {
    slug: "cbc-prodigy-to-nba",
    outlet: "CBC",
    title:
      "From a Six-Year-Old Prodigy to the First Eelam Artist at an NBA Game",
    deck: "How a Scarborough drummer carried Tamil classical music from the temple to Scotiabank Arena, and a national audience.",
    category: "Profile",
    date: "2026-02-08",
    readMins: 5,
    image: "/assets/press/yanchan-live-stage.jpg",
    imageCredit: "Red Lotus Gala / Yanchan Produced",
    externalUrl: "https://www.cbc.ca/",
    body: [
      {
        type: "p",
        text: "When Yanchan Rajmohan walked out onto the floor at Scotiabank Arena for the Toronto Raptors' South Asian Heritage Night, he became the first artist of Eelam origin to perform at an NBA game. For a kid who started on the mridangam at six and became the youngest person in Canada to complete a Mridangam Arangetram, it was a full-circle moment: the temple discipline and the diaspora dream meeting under stadium lights.",
      },
      {
        type: "p",
        text: "The Canadian-Tamil producer has made a career of these crossings. He's performed a CBC set alongside Anjulie at the Glenn Gould Theatre, headlined sold-out shows across Toronto, and shared stages from Mumbai's DY Patil Stadium to arenas in Malaysia and Taipei.",
      },
      {
        type: "quote",
        text: "My grandparents carried this rhythm across an ocean. The least I can do is carry it across a city, across a country, and put it somewhere people don't expect it.",
      },
      {
        type: "p",
        text: "What sets the performances apart is that the mridangam is never decorative. It's the engine. Audiences who arrive for the hip-hop leave talking about the drum; audiences who arrive for the classical tradition leave surprised at how naturally it sits inside a modern beat.",
      },
      {
        type: "p",
        text: "For Yanchan, the mission is explicit: build the future of the South Indian music community, and bring Tamil culture to a global stage. The NBA floor was one stop. He's already planning the next.",
      },
    ],
  },
  {
    slug: "gq-india-two-homes",
    outlet: "GQ India",
    title: "Style, Sound and the 416: Yanchan Produced on Repping Two Homes",
    deck: "The producer on diaspora identity, dressing like the city, and why his merch reads like a love letter to Scarborough and South India at once.",
    category: "Profile",
    date: "2026-05-02",
    readMins: 5,
    image: "/assets/Yanchan-on-opening.jpg",
    imageCredit: "Yanchan Produced",
    externalUrl: "https://www.gqindia.com/",
    body: [
      {
        type: "p",
        text: "Yanchan doesn't separate the sound from the look. The same instinct that puts a live mridangam over a trap beat puts collegiate \"Scarborough 416\" lettering on a rust crewneck and a hand-drawn Carnatic drum on the back of a hoodie. It's all one statement: two homes, worn at the same time.",
      },
      {
        type: "p",
        text: '"The 416 is on everything I make because it made me," he says of his area code. But look closer and the Tamil syllabary curls around the percussion, the mantra (Heart, Passion, Certainty) sits where a logo usually would.',
      },
      {
        type: "quote",
        text: "Clothes are just another beat. You're telling people who you are before you say a word.",
      },
      {
        type: "p",
        text: "It's a sensibility that has made him a quietly compelling style figure in the diaspora, equally at home in a leather jacket on a Scarborough street and in flowing tones carrying his mridangam like a trophy. The aesthetic, like the music, refuses the idea that you have to pick a lane.",
      },
      {
        type: "p",
        text: "As his audience has grown past a quarter-million across platforms, so has the demand to wear the sound. The merch, he insists, isn't a side hustle. It's part of the same bridge he's been building all along.",
      },
    ],
  },
  {
    slug: "vogue-india-sacred-rhythm",
    outlet: "Vogue India",
    title: "The Tamil Producer Bringing Sacred Rhythm to the Global Stage",
    deck: "Yanchan Produced is reframing Carnatic percussion for a generation raised on streaming, without losing an ounce of its devotion.",
    category: "Culture",
    date: "2026-01-19",
    readMins: 6,
    image: "/assets/press/yanchan-mridangam-lift.jpg",
    imageCredit: "Yanchan Produced",
    externalUrl: "https://www.vogue.in/",
    body: [
      {
        type: "p",
        text: "To understand Yanchan, start with the instrument. The mridangam is not just a drum; in Carnatic music it is an act of devotion, governed by centuries of grammar and decades of training. To place it inside a pop song is, to some, a provocation. To Yanchan, it's reverence in a new room.",
      },
      {
        type: "p",
        text: "The Scarborough-raised producer has spent the last two years turning that reverence into reach: from 46,000 monthly listeners to more than 236,000, a five-fold rise, and over 12 million Spotify streams. The numbers matter less than what they represent: a young, global, diasporic audience discovering Carnatic rhythm on its own terms.",
      },
      {
        type: "quote",
        text: "Tradition doesn't survive in a glass case. It survives when young people see themselves in it.",
      },
      {
        type: "p",
        text: "His collaborators read like a map of that ambition: Shruti Haasan, Jonita Gandhi, the composer Santosh Narayanan, alongside North American names. Each pairing is a small argument that the sacred and the contemporary were never as far apart as they seemed.",
      },
      {
        type: "p",
        text: "There is a tenderness beneath the bravado. Yanchan talks about his grandparents, about the ocean their music crossed, about responsibility. The work is loud, but the intention is quiet: make sure the rhythm outlives him.",
      },
    ],
  },
  {
    slug: "homegrown-mrithangam-raps",
    outlet: "Homegrown",
    title:
      "Mrithangam Raps: The Viral Series Rewriting What South Indian Music Sounds Like",
    deck: "A look inside the SVDP collaboration that turned a classical drum into a global hip-hop phenomenon.",
    category: "Music",
    date: "2026-03-30",
    readMins: 4,
    image: "/assets/press/yanchan-studio-mridangam.jpg",
    imageCredit: "Yanchan Produced",
    externalUrl: "https://homegrown.co.in/",
    body: [
      {
        type: "p",
        text: "Few independent series have travelled as far, as fast, as Mrithangam Raps. Built around the chemistry between Yanchan and Canadian-Tamil rapper SVDP, the project does one thing exceptionally well: it lets the mridangam and the MC genuinely converse.",
      },
      {
        type: "p",
        text: "The format is live and unfussy: Yanchan on the drum, SVDP on the mic, the camera close enough to catch the hands. That intimacy is what made it spread. Viewers who'd never heard a note of Carnatic music found themselves rewinding to watch the rhythm land.",
      },
      {
        type: "quote",
        text: "People think fusion means watering things down. We wanted to do the opposite: make both sides hit harder.",
      },
      {
        type: "p",
        text: "With individual entries clearing hundreds of thousands of views, the series has become the clearest expression of Yanchan's thesis: that South Indian classical percussion belongs in the same sentence as trap, drill and R&B, not as an experiment, but as a home.",
      },
    ],
  },
  {
    slug: "now-toronto-danforth-sold-out",
    outlet: "NOW Toronto",
    title: "Yanchan Produced Sells Out the Danforth, and the City Shows Up",
    deck: "A sold-out hometown headline show proved the diaspora's appetite for an artist who refuses to translate himself.",
    category: "Live Review",
    date: "2025-11-12",
    readMins: 4,
    image: "/assets/press/yanchan-live-stage.jpg",
    imageCredit: "Yanchan Produced",
    externalUrl: "https://nowtoronto.com/",
    body: [
      {
        type: "p",
        text: "The line outside The Don on the Danforth started early. By the time Yanchan took the stage for his sold-out headlining set, the room had the charged, familial energy of a hometown that finally gets to see one of its own at full volume.",
      },
      {
        type: "p",
        text: "It's a scene the producer has been building toward through a packed Toronto resume: the Red Lotus Gala at Brighton Convention Center, the Arul EP experience at Empire Supper Club, the CBC performance at Glenn Gould Theatre, an A.R. Rahman tribute at the Living Arts Centre.",
      },
      {
        type: "quote",
        text: "Scarborough showed up for me before anyone else did. Every hometown show is me paying that back.",
      },
      {
        type: "p",
        text: "On stage, the mridangam does the heavy lifting, but the crowd does the rest: singing the Tamil hooks, answering the call-and-response, treating a classical instrument like the headliner it has become. By the encore, the bridge Yanchan keeps talking about felt less like a metaphor and more like the room itself.",
      },
    ],
  },
  {
    slug: "news18-twelve-million-streams",
    outlet: "News18",
    title: "12 Million Streams and Counting: Inside Yanchan's Rise",
    deck: "The Canadian-Tamil producer on a breakout two years, an international tour resume, and what comes after the bridge is built.",
    category: "News",
    date: "2026-04-05",
    readMins: 5,
    image: "/assets/yanchan-portrait.jpg",
    imageCredit: "Yanchan Produced",
    externalUrl: "https://www.news18.com/",
    body: [
      {
        type: "p",
        text: "Two years ago, Yanchan Produced was a respected name in the diaspora music scene with a devoted following. Today he's a 12-million-stream artist with a monthly audience that has grown five-fold and a touring resume that spans six countries.",
      },
      {
        type: "p",
        text: "The growth has been steep but not accidental. Behind the viral moments sits a working producer, mixing engineer and label co-owner who treats the business with the same discipline as the drumming. Emtee Music Group, the boutique firm he co-owns, has become a vehicle for developing other South Indian artists.",
      },
      {
        type: "quote",
        text: "The streams are nice. But the goal was never numbers. It was making space for the people coming after me.",
      },
      {
        type: "p",
        text: "He's opened for 50 Cent at Mumbai's DY Patil Stadium, performed across Malaysia and Taipei, and headlined sold-out rooms at home in Toronto. The catalogue keeps expanding (beat tapes, collaborations, the Arul EP) but the brief stays constant: bring Tamil culture to a global stage, and keep the rhythm live.",
      },
      {
        type: "p",
        text: 'Asked what comes after the bridge is built, Yanchan doesn\'t hesitate. "You build another one," he says. "There\'s always another room that needs the drum."',
      },
    ],
  },
];

export function pressArticleBySlug(slug: string) {
  return PRESS_ARTICLES.find((a) => a.slug === slug);
}

export type Release = {
  id: string;
  /**
   * Where this release sits on the page. Declared, never taken from the array
   * index, so inserting or removing an entry cannot silently move the others.
   * Positions 1 and 2 are Yanchan's own instruction from the 14 Sep call.
   */
  order: number;
  title: string;
  feat?: string;
  year: string;
  art: string;
  /** single · EP · album, shown under the title on /music */
  kind?: string;
  spotify?: string;
  apple?: string;
  youtube?: string;
  /**
   * Bare YouTube id of the official video or Art Track for this release, where
   * one has been verified. Undefined means no video was confirmed, and the
   * player degrades to a link rather than offering a control that plays nothing.
   */
  youtubeId?: string;
  tag?: string;
};

/**
 * RECONCILIATION RECORD
 *
 * Checked 2026-09-14 against the releases themselves, not from memory:
 *  - Spotify per-album credits and cover art, read from the album entity at
 *    open.spotify.com/embed/album/<id>
 *  - Spotify release kind and year, read from the album page metadata
 *  - Apple Music release dates, itunes.apple.com/lookup?id=1666599092
 *  - YouTube video ids and titles, confirmed through youtube.com/oembed
 *
 * Rules applied, from the site-catalogue-accuracy spec:
 *  - Where the site and the release disagreed, the release won.
 *  - A credit that could not be confirmed on the release was dropped, not kept.
 *  - Nothing was completed by picking the most likely value. Anything the
 *    releases could not settle is flagged in NEEDS_YANCHAN below.
 *
 * Fixed in this pass:
 *  - Kalupu: Chin Injeti was missing from the credit.
 *  - Stay Familiar: Kwazii and Mitika Kanwar were missing entirely.
 *  - Nammaaley: "Coke Studio Tamil" was carried as a featured artist. It is
 *    part of the release title. The real credits are Girishh G and Asal Kolaar.
 *  - Hindustani R&B: Pragathi Guruprasad was missing.
 *  - Arul: Sandeep Narayan is credited on all five tracks and was missing.
 *  - Inimel: credited as "Shruti & Kamal Haasan", the release says
 *    "Shruti Haasan & Kamal Haasan".
 *  - Varuvaro and Hype Ones were absent from the site.
 *  - Ajay's Dreams removed on Yanchan's instruction, 14 Sep call: "take off
 *    AJ's dreams". Do not reintroduce it from a later sync.
 */
const RELEASE_ENTRIES: Release[] = [
  {
    id: "kalupu",
    order: 1,
    title: "Kalupu",
    // Spotify: Telamil, Chin Injeti, Yanchan Produced. Single, 2026-06-23.
    feat: "Telamil & Chin Injeti",
    year: "2026",
    kind: "Single",
    art: "https://i.scdn.co/image/ab67616d0000b273d9cc00b4f3b18373372eba9e",
    tag: "Top track",
    spotify: "https://open.spotify.com/album/41XnACuC6ELhN1TFN8tP0p",
    youtube: "https://www.youtube.com/watch?v=rIjn4uNyzaM",
    youtubeId: "rIjn4uNyzaM",
  },
  {
    id: "chai-and-sunshine",
    order: 2,
    title: "Chai and Sunshine",
    // Spotify: Anjulie, Yanchan Produced. Single, 2024-07-01.
    feat: "Anjulie",
    year: "2024",
    kind: "Single",
    art: "https://i.scdn.co/image/ab67616d0000b2736cc1f4c68eb6e2e6ef2bf0ef",
    spotify: "https://open.spotify.com/album/5oUn0GXhoPTM3e1g7Pk65J",
    youtube: "https://www.youtube.com/watch?v=lH3SdlkeudA",
    youtubeId: "lH3SdlkeudA",
  },
  {
    id: "hype-ones",
    order: 3,
    title: "Hype Ones",
    // Spotify: Rohan, Ratty Adhiththan, Yanchan Produced. Single, 2026-07-24.
    feat: "Rohan & Ratty Adhiththan",
    year: "2026",
    kind: "Single",
    art: "https://i.scdn.co/image/ab67616d0000b2733ea6de1deda349008c93de8f",
    spotify: "https://open.spotify.com/album/6JCybGgD9nCfMDSFDC6CDX",
    youtube: "https://www.youtube.com/watch?v=pds0nuqMG_E",
    youtubeId: "pds0nuqMG_E",
  },
  {
    id: "varuvaro",
    order: 4,
    title: "Varuvaro",
    // Spotify: Yanchan Produced, Sandeep Narayan. Single, 2026-04-12.
    feat: "Sandeep Narayan",
    year: "2026",
    kind: "Single",
    art: "https://i.scdn.co/image/ab67616d0000b27351e95f3e980d27c6c7fd8fcd",
    spotify: "https://open.spotify.com/album/2n4rKiqU6l1jFEiTFs1k2H",
    youtube: "https://www.youtube.com/watch?v=liudAyp3Md4",
    youtubeId: "liudAyp3Md4",
  },
  {
    id: "anu",
    order: 5,
    title: "Anu",
    // Spotify: Kelithee, Yanchan Produced. Single, 2026-05-29.
    feat: "Kelithee",
    year: "2026",
    kind: "Single",
    art: "https://i.scdn.co/image/ab67616d0000b2730696d26427217488525a70a9",
    spotify: "https://open.spotify.com/album/3moHanqoeuxCLUhtPs2Jqz",
    youtube: "https://www.youtube.com/watch?v=6pK6pD2voLk",
    youtubeId: "6pK6pD2voLk",
  },
  {
    id: "stay-familiar",
    order: 6,
    title: "Stay Familiar",
    // Spotify: Yanchan Produced, Kwazii, Mitika Kanwar. Single, 2026-03-16.
    feat: "Kwazii & Mitika Kanwar",
    year: "2026",
    kind: "Single",
    art: "https://i.scdn.co/image/ab67616d0000b27334355875e2f6d70eacdb65ca",
    spotify: "https://open.spotify.com/album/3ay84pN1sTbkBt1toffvOA",
    youtube: "https://www.youtube.com/watch?v=8BtvOKID-TU",
    youtubeId: "8BtvOKID-TU",
  },
  {
    id: "nammaaley",
    order: 7,
    // Full title as released on Spotify and Apple Music.
    title: "Nammaaley | Coke Studio Tamil",
    // Spotify: Girishh G, Asal Kolaar, Yanchan Produced. Single, 2024-07-25.
    feat: "Girishh G & Asal Kolaar",
    year: "2024",
    kind: "Single",
    art: "https://i.scdn.co/image/ab67616d0000b273523e82c5b32d88692fe72ab2",
    spotify: "https://open.spotify.com/album/2BkwCQUso8kHcEjxtDQOmm",
    youtube: "https://www.youtube.com/watch?v=ehQFhlZHWw0",
    youtubeId: "ehQFhlZHWw0",
  },
  {
    id: "mrithangam-raps",
    order: 8,
    title: "Mrithangam Raps",
    // Spotify: SVDP, Yanchan Produced. Album, 2023, 13 songs.
    feat: "SVDP",
    year: "2023",
    kind: "Album",
    art: "https://i.scdn.co/image/ab67616d0000b2739c1f5320c511f11cb096b95b",
    spotify: "https://open.spotify.com/album/2uMcD2SZ7FaF8x6J7eEe9t",
    // No single video is the album, so nothing is claimed here.
  },
  {
    id: "arul",
    order: 9,
    title: "Arul",
    // Spotify: Yanchan Produced, Sandeep Narayan on all five tracks. EP, 2023.
    feat: "Sandeep Narayan",
    year: "2023",
    kind: "EP",
    art: "https://i.scdn.co/image/ab67616d0000b273d2f2d958e3a0a0662f668aee",
    spotify: "https://open.spotify.com/album/7EghDDMtm6CnX3Q31D41XB",
  },
  {
    id: "pudhu-wave",
    order: 10,
    title: "PUDHU WAVE",
    // Spotify: Tha Mystro, Yanchan Produced. Album, 2024, 7 songs.
    feat: "Tha Mystro",
    year: "2024",
    kind: "Album",
    art: "https://i.scdn.co/image/ab67616d0000b27335be4ab27ad7cba8569bb869",
    spotify: "https://open.spotify.com/album/3OcyhHrULvU3xzv5r2VcaD",
  },
  {
    id: "hindustani-rnb",
    order: 11,
    title: "Hindustani R&B",
    // Spotify: Yanchan Produced, Pragathi Guruprasad. Single, 2024-10-25.
    feat: "Pragathi Guruprasad",
    year: "2024",
    kind: "Single",
    art: "https://i.scdn.co/image/ab67616d0000b27322a6565a1e690c5fdaca140e",
    spotify: "https://open.spotify.com/album/359IIDpgQyt5Z6AbbA69jN",
  },
  {
    id: "inimel",
    order: 12,
    title: "Inimel",
    // Apple Music: Shruti Haasan & Kamal Haasan, single, 2024-03-25. Yanchan's
    // own involvement is not stated on the release, so it is open with him.
    feat: "Shruti Haasan & Kamal Haasan",
    year: "2024",
    kind: "Single",
    art: "/assets/Inimel.jpg",
    // Was pointed at the channel, which is not the record. This is the release
    // itself, YouTube's Art Track for the single on Shruti Haasan's channel.
    youtube: "https://www.youtube.com/watch?v=lK3O5h8AYJg",
    youtubeId: "lK3O5h8AYJg",
  },
  {
    id: "remember",
    order: 13,
    title: "Remember",
    // Not on Spotify or Apple Music. Confirmed from Yanchan's own YouTube
    // channel: "Remember - Yanchan Produced | Full Version", published
    // 2022-07-12, which is where the year and the link now come from.
    year: "2022",
    kind: "Single",
    art: "/assets/remember-1024x1024.png",
    youtube: "https://www.youtube.com/watch?v=1pc-Rwtuxw4",
    youtubeId: "1pc-Rwtuxw4",
  },
];

/**
 * The rendered catalogue. Sorted by the declared `order`, so the array above
 * can be edited in any sequence without moving the page.
 */
export const RELEASES: Release[] = [...RELEASE_ENTRIES].sort(
  (a, b) => a.order - b.order,
);

/**
 * Open with Yanchan. Nothing here is guessed on the page, and nothing here is
 * rendered as if it were settled.
 *
 *  1. Mrithangam Raps numbering. He asked on 14 Sep whether the episode shown
 *     as "Episode 3" is really called that. YouTube's own title for that video
 *     is "SVDP X Yanchan Produced - Mrithangam Raps: Episode 3", and the
 *     Spotify album carries Episode 1, Episode 2 and Episode 3 as separate
 *     tracks. Left exactly as it was, pending his call. Note the channel also
 *     hosts a second "Mrithangam Raps: Episode 6" upload under a different id.
 *  2. Inimel. The release is credited to Shruti Haasan and Kamal Haasan.
 *     Yanchan is not a credited artist on it, so his involvement cannot be
 *     confirmed from the release. Kept, with the official credit, pending him.
 *  3. Remember. No Spotify or Apple Music entry exists. Only his own YouTube
 *     upload confirms it. Kept on that basis.
 *  4. Order below position 2. He named Kalupu and Chai and Sunshine only. The
 *     rest are provisional and he still owes the sequence.
 *  5. The rejected release photo from the call has not been identified. Nobody
 *     has said which one it is, so nothing has been swapped.
 *  6. Verified releases that are NOT on the site, from the full Apple Music
 *     and Spotify re-pull on 2026-09-14. His to include or leave off:
 *     Billo (Simar, 2026-07-30), Kalupu Bijaan Remix (2026-07-24),
 *     Chinna Maata (2025-10-10), Space, The Theme of MilapSpace (2025-07-21),
 *     Hard To Love You (2024-08-07), Thanguma (2024-06-06),
 *     Unnaale (2024-03-27), Made in Jaffna (2021-08-20),
 *     Picasso (2020-07-31), Sentimental Kids (2019-11-15),
 *     Happen Like This (2019-10-18), Fantasy (2019-08-02),
 *     I Know (2019-06-28), Want You (2019-01-10), Yacht (2018-10-10),
 *     Coming Down (2018-05-21), Get It (2018-03-24), Same Old (2017-12-25),
 *     All Out (2017-09-06), Yours Truly EP (2016-11-09),
 *     See Me Now (2022-11-09).
 */
export const NEEDS_YANCHAN = [
  "Mrithangam Raps episode numbering",
  "Inimel production credit",
  "Remember release data",
  "Catalogue order below position 2",
  "The rejected release photo",
  "Which of the 21 verified back-catalogue releases belong on the site",
] as const;

export const YOUTUBE_CHANNEL = "https://www.youtube.com/@yanchanproduced";

export type VideoItem = {
  id: string;
  title: string;
  youtubeId: string;
  series?: string;
  note?: string;
};

// Thumbnails are pulled straight from YouTube (see ytThumb) so they never drift
// out of sync with the uploads. Every id below was confirmed through
// youtube.com/oembed on 2026-09-14 and resolves to the video named here.
// The episode numbering is Yanchan's open question, see NEEDS_YANCHAN.
export const VIDEOS: VideoItem[] = [
  {
    id: "chai-and-sunshine",
    title: "Chai and Sunshine",
    youtubeId: "lH3SdlkeudA",
    series: "Anjulie × Yanchan Produced",
    note: "Official audio",
  },
  {
    id: "mr-ep-3",
    title: "Mrithangam Raps: Episode 3",
    youtubeId: "ceDFShaaYOA",
    series: "SVDP × Yanchan Produced",
    note: "The one that broke out",
  },
  {
    id: "mr-the-shining",
    title: "The Shining, Mrithangam Raps: Episode 10",
    youtubeId: "VqQckD72P3Q",
    series: "SVDP × Yanchan Produced",
  },
  {
    id: "mr-ep-6",
    title: "Mrithangam Raps: Episode 6",
    youtubeId: "Yv-isvNDA9o",
    series: "SVDP × Yanchan Produced",
    note: "Kanye · Kendrick reworked on mridangam",
  },
  {
    id: "mr-ep-1",
    title: "Mrithangam Raps: Episode 1",
    youtubeId: "SO5dkapGVj8",
    series: "SVDP × Yanchan Produced",
    note: "Where the series started",
  },
  {
    id: "mr-ep-8",
    title: "Mrithangam Raps: Episode 08",
    youtubeId: "OEA4KVazNBQ",
    series: "SVDP × Yanchan Produced",
  },
];

export type Session = {
  id: string;
  /** The guest artist featured in the session. */
  guest: string;
  edition: string;
  /**
   * YouTube video id. Every session is uploaded to his channel as a vertical
   * Short, so `oardefault.jpg` returns the original 9:16 frame and the tile
   * keeps the portrait shape the series has always had. No crop, no letterbox.
   */
  youtubeId: string;
  /**
   * Declared position. Set from the upload date, newest first. Deliberately not
   * from engagement: Yanchan asked for the like counts to come off, and a
   * number that is not shown must not be quietly deciding the running order.
   */
  order: number;
};

/**
 * Orange Room Sessions, his studio series, filmed under the அருள் neon.
 *
 * These render from YouTube, not from Instagram. On the 14 Sep call Yanchan
 * said of the series, looking at the Instagram surface, "this is going to the
 * YouTube", and "I don't want the likes to be on this".
 *
 * Every id was confirmed on 2026-09-14 through youtube.com/oembed against his
 * own channel, and every one returned a 9:16 `oardefault.jpg` poster.
 * A session with no YouTube version is held rather than shown from Instagram.
 * All five that were on the site had one, so none are currently held.
 */
export const SESSIONS: Session[] = [
  {
    id: "shruti-haasan",
    guest: "Shruti Haasan",
    edition: "Orange Room Sessions",
    youtubeId: "op-uFnAOf-w", // published 2026-09-14, confirmed via oembed
    order: 0,
  },
  {
    id: "kalisway",
    guest: "Kalisway",
    edition: "Orange Room Sessions",
    youtubeId: "Eq7SR-E04Ak", // published 2026-09-07
    order: 1,
  },
  {
    id: "merza",
    guest: "Merza",
    edition: "Orange Room Sessions",
    youtubeId: "PQXqq2TTd1I", // published 2026-07-20
    order: 2,
  },
  {
    id: "nia-nadurata",
    guest: "Nia Nadurata",
    edition: "Orange Room Sessions",
    youtubeId: "fTkpFPAsIC8", // published 2026-06-29
    order: 3,
  },
  {
    id: "ben-parag",
    guest: "Ben Parag",
    edition: "Orange Room Sessions",
    youtubeId: "0YKeayJHISU", // published 2026-06-08
    order: 4,
  },
  {
    id: "happy-singh",
    guest: "Happy Singh",
    edition: "Orange Room Sessions",
    youtubeId: "jmQtWzPmai0", // published 2026-05-25
    order: 5,
  },
];

export const INSTAGRAM = "https://www.instagram.com/yanchanproduced/";

export type Reel = {
  /** Instagram shortcode. Drives both the embed and the permalink. */
  code: string;
  /** The guest artist featured in the reel. */
  title: string;
  edition: string;
  poster: string;
};

/**
 * The Instagram surface. It carries the India Edition and social content, which
 * is not the same work as the YouTube sessions above.
 *
 * `likes` was removed from this type on 2026-09-14. Yanchan asked for the like
 * counts to come off, so the number is neither rendered nor stored, and it
 * cannot be used as a sort key by accident later.
 *
 * Posters are each reel's own cover frame, stored locally so they don't depend
 * on Instagram's expiring CDN URLs. Verified 2026-07-28.
 */
export const REELS: Reel[] = [
  {
    code: "DW1MO9pDvnZ",
    title: "Shruti Haasan",
    edition: "India Edition",
    poster: "/assets/reels/DW1MO9pDvnZ.jpg",
  },
  {
    code: "DUQfLgGDr1G",
    title: "Bhumi",
    edition: "India Edition",
    poster: "/assets/reels/DUQfLgGDr1G.jpg",
  },
];

/**
 * YouTube's own thumbnail hosts.
 *  - `max` and `hq` are the 16:9 frames, used by the landscape video gallery.
 *  - `oar` is the original aspect ratio frame. A vertical Short returns it at
 *    9:16, which is what keeps the session tiles in their portrait shape
 *    instead of squeezing a 16:9 still into a portrait box.
 */
export function ytThumb(
  youtubeId: string,
  quality: "max" | "hq" | "oar" = "max",
) {
  const file =
    quality === "max"
      ? "maxresdefault"
      : quality === "hq"
        ? "hqdefault"
        : "oardefault";
  return `https://i.ytimg.com/vi/${youtubeId}/${file}.jpg`;
}

export type License = { id: string; name: string; price: number; note: string };

export type Beat = {
  id: string;
  title: string;
  bpm: number;
  key: string;
  mood: string[];
  art: string;
  exclusivePrice: number;
  exclusiveSold?: boolean;
  licenses: License[];
};

const STANDARD_LICENSES: License[] = [
  {
    id: "mp3",
    name: "MP3 Lease",
    price: 29,
    note: "Untagged MP3 · 5k streams",
  },
  { id: "wav", name: "WAV Lease", price: 49, note: "WAV + MP3 · 10k streams" },
  {
    id: "trackout",
    name: "Trackout / Stems",
    price: 99,
    note: "Full stems · 100k streams",
  },
];

export const BEATS: Beat[] = [
  {
    id: "scarborough-nights",
    title: "Scarborough Nights",
    bpm: 140,
    key: "F# min",
    mood: ["Trap", "Dark", "Mridangam"],
    art: "/assets/artworks-TYlB41cABBrqKEbB-NESP9g-t500x500.jpg",
    exclusivePrice: 499,
    licenses: STANDARD_LICENSES,
  },
  {
    id: "thavil-anthem",
    title: "Thavil Anthem",
    bpm: 128,
    key: "A min",
    mood: ["Drill", "Carnatic", "Hard"],
    art: "/assets/artworks-YYsBWyFy2uBq-0-t500x500.jpg",
    exclusivePrice: 599,
    licenses: STANDARD_LICENSES,
  },
  {
    id: "smooth-like-cognac",
    title: "Smooth Like Cognac",
    bpm: 92,
    key: "D maj",
    mood: ["R&B", "Lover Boy", "Soul"],
    art: "/assets/anjuliemusic_abstract_heart_ethereal_oil_painting_warm_colors_574f5995-d3f6-4780-94d5-fabe392cca87.png",
    exclusivePrice: 449,
    licenses: STANDARD_LICENSES,
  },
  {
    id: "eelam-pride",
    title: "Eelam Pride",
    bpm: 150,
    key: "C min",
    mood: ["Trap", "Cinematic", "Kanjira"],
    art: "/assets/Brown-Vintage-Minimalist-Music-Album-Cover-3-1-1024x1024.png",
    exclusivePrice: 699,
    exclusiveSold: true,
    licenses: STANDARD_LICENSES,
  },
  {
    id: "diaspora-bounce",
    title: "Diaspora Bounce",
    bpm: 135,
    key: "G min",
    mood: ["Afroswing", "Bounce", "Ghatam"],
    art: "/assets/remember-1024x1024.png",
    exclusivePrice: 549,
    licenses: STANDARD_LICENSES,
  },
  {
    id: "lean-into-the-fear",
    title: "Lean Into The Fear",
    bpm: 144,
    key: "E min",
    mood: ["Trap", "Anthemic", "Mridangam"],
    art: "/assets/Big-City.jpg",
    exclusivePrice: 499,
    licenses: STANDARD_LICENSES,
  },
];

export type SamplePack = {
  id: string;
  title: string;
  price: number;
  count: string;
  art: string;
  blurb: string;
};

export const PACKS: SamplePack[] = [
  {
    id: "carnatic-trap-vol1",
    title: "Carnatic Trap Vol. 1",
    price: 39,
    count: "120 samples · 40 loops",
    art: "/assets/Background-scaled.jpg",
    blurb:
      "Kanjira, ghatam, thavil and mridangam chopped for trap, drill and R&B. Royalty-free.",
  },
  {
    id: "scarborough-soul",
    title: "Scarborough Soul",
    price: 49,
    count: "90 samples · 25 melodies",
    art: "/assets/Yanchan-on-opening.jpg",
    blurb:
      "Warm keys, vinyl textures and South Indian vocal chops. The lover-boy sound.",
  },
];

export type TourDate = {
  id: string;
  date: string; // ISO
  city: string;
  venue: string;
  ticketUrl?: string;
  soldOut?: boolean;
  /** Backdrop revealed when the row is hovered on the tour board. */
  image?: string;
};

/**
 * Yanchan Produced Live 2026, the four-city run printed on the tour merch.
 * Dates are from Yanchan's own announcement (YouTube, "GET TIX TO YANCHAN
 * PRODUCED LIVE 2026": Sept 18 Toronto, Sept 19 New York City, Oct 9
 * Vancouver, Oct 10 San Francisco). Verified 2026-09-19:
 *
 * - Toronto: VETRI presents "Live + Friends: The Boiler Edition ft. 3D
 *   Sound", The Pearl Events. Eventbrite listing reads SOLD OUT.
 * - New York: ar•ram•bam presents "Live & Friends in New York City", Soho
 *   Live, doors 9pm. Posh listing, from Yanchan's Instagram bio.
 * - San Francisco: ar•ram•bam's Oct 10 night at Eve Nightclub is the only
 *   SF listing on that date from the same promoter, but its page still says
 *   "DJ lineup to be revealed" and does not name him. Linked as the best
 *   available page; confirm with Yanchan before launch.
 * - Vancouver: date announced, no ticket page found anywhere yet. Listed
 *   without a link so it shows as "Announced", not "Sold out".
 */
export const TOUR: TourDate[] = [
  {
    id: "yp-live-2026-toronto",
    date: "2026-09-18",
    city: "Toronto, ON",
    venue: "The Pearl Events",
    ticketUrl:
      "https://www.eventbrite.ca/e/yanchan-produced-live-friends-the-boiler-edition-ft-3d-sound-toronto-tickets-1998386864908",
    soldOut: true,
    image: "/assets/press/yanchan-live-stage.jpg",
  },
  {
    id: "yp-live-2026-nyc",
    date: "2026-09-19",
    city: "New York, NY",
    venue: "Soho Live",
    ticketUrl: "https://posh.vip/e/yanchan-produced-live-friends-in-new-york-city",
    image: "/assets/Rectangle-35.jpg",
  },
  {
    id: "yp-live-2026-vancouver",
    date: "2026-10-09",
    city: "Vancouver, BC",
    venue: "Venue to be announced",
    image: "/assets/yanchan-portrait.jpg",
  },
  {
    id: "yp-live-2026-sf",
    date: "2026-10-10",
    city: "San Francisco, CA",
    venue: "Eve Nightclub & Lounge",
    ticketUrl:
      "https://www.handstamp.com/e/7th-tamil-meetup-in-san-francisco-fall-kuthu-fest",
    image: "/assets/hero-artist.jpg",
  },
];

/** Home base — shown on the tour board corner readout. */
export const BASE = {
  label: "Scarborough, ON",
  coords: "43.7764° N, 79.2318° W",
  timeZone: "America/Toronto",
} as const;

/**
 * The two sample kit questions were removed on 2026-09-14, on Yanchan's
 * instruction that the kit and sample pack wording comes off. The copy went,
 * the `PACKS` and `BEATS` data did not: the product-line decision is open.
 * "Custom beats" below is his craft, not a kit, and stays.
 */
export const FAQ = [
  {
    q: "Do you take custom production or features?",
    a: "Absolutely. Custom beats, mridangam sessions, mixing and features. Use the booking form and I'll get back to you personally.",
  },
  {
    q: "Is the mridangam real?",
    a: "Always. Every percussion sound is performed live, not sampled from a library. That's the whole point.",
  },
];

export function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
