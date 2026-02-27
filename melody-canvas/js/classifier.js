/* ═══════════════════════════════════════════════════════════════════════════
   classifier.js — Genre classifier

   Scores extracted musical features against each genre's profile from
   music_styles.json. Returns ranked genre matches with confidence scores.

   Scoring model:
     Each genre has a feature profile derived from its features{} block.
     We score on 6 dimensions and compute a weighted sum:
       tempo match        (30%)
       harmony match      (25%)
       rhythm match       (20%)
       mode match         (15%)
       chord complexity   (10%)
   ═══════════════════════════════════════════════════════════════════════════ */

const STYLES = {
  "Classical": {
    "subgenres": [
      "Andalusian classical music",
      "Indian classical music",
      "Korean court music",
      "Persian classical music",
      "Kurdish classical music",
      "Ottoman music",
      "Western classical music",
      "Early music",
      "Medieval music",
      "Ars antiqua",
      "Ars nova",
      "Ars subtilior",
      "Renaissance music",
      "Baroque music",
      "Galant music",
      "Classical period",
      "Romantic music",
      "20th and 21st-centuries classical music",
      "Modernism",
      "Impressionism",
      "Neoclassicism",
      "High modernism",
      "Postmodern music",
      "Experimental music",
      "Contemporary classical music",
      "Minimal music",
      "Avant-Garde",
      "Ballet",
      "Baroque",
      "Cantata",
      "Chamber Music",
      "Chant",
      "Choral",
      "Classical Crossover",
      "Concerto",
      "Concerto Grosso",
      "Contemporary Classical",
      "Early Music",
      "Expressionist",
      "High Classical",
      "Impressionist",
      "Mass Requiem",
      "Medieval",
      "Minimalism",
      "Modern Composition",
      "Modern Classical",
      "Opera",
      "Oratorio",
      "Orchestral",
      "Organum",
      "Renaissance",
      "Romantic (early period)",
      "Romantic (later period)",
      "Sonata",
      "Symphonic",
      "Symphony",
      "Twelve-tone",
      "Wedding Music"
    ],
    "features": {
      "tempo": "Varied, often 60-160 BPM",
      "instruments": [
        "orchestra",
        "piano",
        "violin",
        "cello",
        "harpsichord"
      ],
      "rhythm": "Structured, metered, complex time signatures",
      "harmony": "Tonal, complex progressions",
      "other": "Emphasis on form, composition, orchestration"
    }
  },
  "Avant-garde & experimental": {
    "subgenres": [
      "Avant-garde",
      "Experimental"
    ],
    "features": {
      "tempo": "Varied",
      "instruments": [
        "Any, often unconventional"
      ],
      "rhythm": "Free, non-metric",
      "harmony": "Atonal, dissonant",
      "other": "Rejection of traditional structures"
    }
  },
  "Blues": {
    "subgenres": [
      "Acoustic Blues",
      "African Blues",
      "Blues Rock",
      "Blues Shouter",
      "British Blues",
      "Canadian Blues",
      "Chicago Blues",
      "Classic Blues",
      "Classic Female Blues",
      "Contemporary Blues",
      "Contemporary R&B",
      "Country Blues",
      "Dark Blues",
      "Delta Blues",
      "Detroit Blues",
      "Doom Blues",
      "Electric Blues",
      "Folk Blues",
      "Gospel Blues",
      "Harmonica Blues",
      "Hill Country Blues",
      "Hokum Blues",
      "Jazz Blues",
      "Jump Blues",
      "Kansas City Blues",
      "Louisiana Blues",
      "Memphis Blues",
      "Modern Blues",
      "New Orlean Blues",
      "NY Blues",
      "Piano Blues",
      "Piedmont Blues",
      "Punk Blues",
      "Ragtime Blues",
      "Rhythm Blues",
      "Soul Blues",
      "St. Louis Blues",
      "Swamp Blues",
      "Texas Blues",
      "Urban Blues",
      "Vandeville",
      "West Coast Blues",
      "Zydeco"
    ],
    "features": {
      "tempo": "60-120 BPM",
      "instruments": [
        "guitar",
        "harmonica",
        "piano",
        "bass",
        "drums"
      ],
      "rhythm": "Shuffle, swing, 12/8 feel",
      "harmony": "I-IV-V progressions, blue notes",
      "other": "Expressive vocals, call-and-response"
    }
  },
  "Country": {
    "subgenres": [
      "Alternative Country",
      "Americana",
      "Australian Country",
      "Bakersfield Sound",
      "Bluegrass",
      "Blues Country",
      "Cajun Fiddle Tunes",
      "Christian Country",
      "Classic Country",
      "Close Harmony",
      "Contemporary Bluegrass",
      "Contemporary Country",
      "Country Gospel",
      "Country Pop",
      "Country Rap",
      "Country Rock",
      "Country Soul",
      "Cowboy / Western",
      "Cowpunk",
      "Dansband",
      "Honky Tonk",
      "Franco-Country",
      "Gulf and Western",
      "Hellbilly Music",
      "Instrumental Country",
      "Lubbock Sound",
      "Nashville Sound",
      "Neotraditional Country",
      "Outlaw Country",
      "Progressive",
      "Psychobilly / Punkabilly",
      "Red Dirt",
      "Sertanejo",
      "Texas County",
      "Traditional Bluegrass",
      "Traditional Country",
      "Truck-Driving Country",
      "Urban Cowboy",
      "Western Swing",
      "Zydeco",
      "Inspirational Country"
    ],
    "features": {
      "tempo": "80-140 BPM",
      "instruments": [
        "acoustic guitar",
        "fiddle",
        "steel guitar",
        "banjo",
        "bass"
      ],
      "rhythm": "Steady beat, often 4/4",
      "harmony": "Simple chords, major keys",
      "other": "Storytelling lyrics, twangy vocals"
    }
  },
  "Easy Listening": {
    "subgenres": [
      "Background",
      "Bop",
      "Elevator",
      "Furniture",
      "Lounge",
      "Middle of the Road",
      "Swing"
    ],
    "features": {
      "tempo": "60-100 BPM",
      "instruments": [
        "strings",
        "piano",
        "saxophone"
      ],
      "rhythm": "Smooth, even",
      "harmony": "Consonant, lush",
      "other": "Relaxing, non-intrusive"
    }
  },
  "Electronic": {
    "subgenres": [
      "2-Step",
      "8bit",
      "Ambient",
      "Asian Underground",
      "Bassline",
      "Chillwave",
      "Chiptune",
      "Crunk",
      "Downtempo",
      "Drum & Bass",
      "Electro",
      "Electro-swing",
      "Electroacoustic",
      "Electronica",
      "Electronic Rock",
      "Eurodance",
      "Hardstyle",
      "Hi-Nrg",
      "IDM/Experimental",
      "Industrial",
      "Trip Hop",
      "Vaporwave",
      "UK Garage",
      "Future Garage",
      "Synthwave",
      "Game Soundtrack",
      "Italodisco",
      "Deep Dark House",
      "Hardbass",
      "Dubstep",
      "Electro",
      "Future House",
      "Hauntology"
    ],
    "features": {
      "tempo": "60-180 BPM depending on subgenre (e.g., House 115-130, Dubstep 135-145)",
      "instruments": [
        "synthesizers",
        "drum machines",
        "samplers"
      ],
      "rhythm": "Repetitive beats, loops",
      "harmony": "Minimal, repetitive",
      "other": "Electronic production, effects"
    }
  },
  "Dance": {
    "subgenres": [
      "Club / Club Dance",
      "Breakcore",
      "Breakbeat / Breakstep",
      "Brostep",
      "Chillstep",
      "Deep House",
      "Dubstep",
      "Electro House",
      "Electroswing",
      "Exercise",
      "Future Garage",
      "Garage",
      "Glitch Hop",
      "Glitch Pop",
      "Grime",
      "Hardcore",
      "Hard Dance",
      "Hi-NRG / Eurodance",
      "Horrorcore",
      "House",
      "Jackin House",
      "Jungle / Drum\u2019n\u2019bass",
      "Liquid Dub",
      "Regstep",
      "Speedcore",
      "Techno",
      "Trance",
      "Trap",
      "Funk House",
      "Ghetto house",
      "Ghost house",
      "Jazz house",
      "Spooky house",
      "Spooky funk House",
      "Spooky rock house",
      "Fun house",
      "Electro house",
      "Tech house",
      "Deep house",
      "Progressive house",
      "Minimal house",
      "French House",
      "EDM Type 1",
      "EDM Type 2",
      "Footwork",
      "Gqom",
      "Amapiano",
      "UK Funky/Funky House"
    ],
    "features": {
      "tempo": "115-180 BPM",
      "instruments": [
        "synths",
        "drums",
        "bass"
      ],
      "rhythm": "4/4 kick, hi-hats",
      "harmony": "Simple progressions",
      "other": "Designed for dancing"
    }
  },
  "Folk": {
    "subgenres": [
      "American Folk Revival",
      "Anti-Folk",
      "British Folk Revival",
      "Contemporary Folk",
      "Filk Music",
      "Freak Folk",
      "Indie Folk",
      "Industrial Folk",
      "Neofolk",
      "Progressive Folk",
      "Psychedelic Folk",
      "Sung Poetry",
      "Techno-Folk"
    ],
    "features": {
      "tempo": "60-120 BPM",
      "instruments": [
        "acoustic guitar",
        "banjo",
        "fiddle",
        "mandolin"
      ],
      "rhythm": "Simple, acoustic",
      "harmony": "Modal, traditional",
      "other": "Storytelling, cultural roots"
    }
  },
  "Hip-Hop/Rap": {
    "subgenres": [
      "Alternative Rap",
      "Avant-Garde",
      "Bounce",
      "Chap Hop",
      "Christian Hip Hop",
      "Conscious Hip Hop",
      "Country-Rap",
      "Grunk",
      "Crunkcore",
      "Cumbia Rap",
      "Dirty South",
      "East Coast",
      "Freestyle Rap",
      "G-Funk",
      "Gangsta Rap",
      "Golden Age",
      "Grime",
      "Hardcore Rap",
      "Hip-Hop",
      "Hip Pop",
      "Horrorcore",
      "Hyphy",
      "Industrial Hip Hop",
      "Instrumental Hip Hop",
      "Jazz Rap",
      "Latin Rap",
      "Low Bap",
      "Lyrical Hip Hop",
      "Merenrap",
      "Midwest Hip Hop",
      "Motswako",
      "Nerdcore",
      "New Jack Swing",
      "New School Hip Hop",
      "Old School Rap",
      "Rap",
      "Trap",
      "Turntablism",
      "Underground Rap",
      "West Coast Rap",
      "Pop rap"
    ],
    "features": {
      "tempo": "60-100 BPM",
      "instruments": [
        "beats",
        "samples",
        "turntables",
        "vocals"
      ],
      "rhythm": "Syncopated, backbeat",
      "harmony": "Minimal, looped",
      "other": "Rhyming lyrics, beats"
    }
  },
  "Jazz": {
    "subgenres": [
      "Acid Jazz",
      "Avant-Garde Jazz",
      "Bebop",
      "Big Band",
      "Blue Note",
      "Contemporary Jazz",
      "Cool",
      "Crossover Jazz",
      "Dixieland",
      "Ethio-jazz",
      "Fusion",
      "Gypsy Jazz",
      "Hard Bop",
      "Latin Jazz",
      "Mainstream Jazz",
      "Ragtime",
      "Smooth Jazz",
      "Trad Jazz",
      "Third Stream",
      "Vocal Jazz"
    ],
    "features": {
      "tempo": "Varied, 60-200 BPM",
      "instruments": [
        "saxophone",
        "trumpet",
        "piano",
        "bass",
        "drums"
      ],
      "rhythm": "Swing, syncopation",
      "harmony": "Complex chords, improvisation",
      "other": "Blue notes, call-response"
    }
  },
  "Pop": {
    "subgenres": [
      "Adult Contemporary",
      "Adult Hits",
      "Alternative Pop",
      "Ambient Pop",
      "Arabic Pop Music",
      "Art Pop",
      "Avant-Pop",
      "Baroque Pop",
      "Beach Music",
      "Bedroom Pop",
      "Brill Building",
      "Britpop",
      "Bubblegum Pop",
      "Canci\u00f3n",
      "Canzone",
      "Chalga",
      "Chamber Pop",
      "Chanson",
      "Christian Pop",
      "Classic Hits",
      "Classical Crossover",
      "Contemporary Hit Radio",
      "Country Pop",
      "Cringe Pop",
      "Dance-Pop",
      "Dark Pop",
      "Disco",
      "Eurodisco",
      "Folk Pop",
      "Hyperpop",
      "Indie Pop",
      "Twee Pop",
      "Indian Pop",
      "Iranian Pop",
      "Jangle Pop",
      "Jazz Pop",
      "Latin Ballad",
      "Latin Pop",
      "Mexican Pop Music",
      "New Pop",
      "New Romantic",
      "Oldies",
      "Operatic Pop",
      "Orchestral Pop",
      "Original Pilipino Music",
      "Pinoy Pop",
      "Pop Rap",
      "Pop Soul",
      "Progressive Pop",
      "Psychedelic Pop",
      "Rebetiko",
      "Rhythmic Adult Contemporary",
      "Rhythmic Contemporary",
      "Rhythmic Oldies",
      "Schlager Music",
      "Sophisti-Pop",
      "Space Age Pop",
      "Sunshine Pop",
      "Swamp Pop",
      "Synth-Pop",
      "Electropop",
      "Teen Pop",
      "Traditional Pop",
      "Turbo-Folk",
      "Turkish Pop Music",
      "Urban Adult Contemporary",
      "Urban Contemporary Music",
      "Vispop",
      "Wonky Pop",
      "Worldbeat",
      "Y\u00e9-y\u00e9"
    ],
    "features": {
      "tempo": "100-130 BPM",
      "instruments": [
        "vocals",
        "guitar",
        "keyboard",
        "drums"
      ],
      "rhythm": "Catchy, 4/4",
      "harmony": "Simple, hook-based",
      "other": "Melodic, commercial"
    }
  },
  "R&B & Soul": {
    "subgenres": [
      "Contemporary R&B",
      "Disco",
      "Funk",
      "Modern Soul",
      "Motown",
      "Neo-Soul",
      "Northern Soul",
      "Psychedelic Soul",
      "Quiet Storm",
      "Soul",
      "Soul Blues",
      "Southern Soul"
    ],
    "features": {
      "tempo": "60-120 BPM",
      "instruments": [
        "vocals",
        "bass",
        "guitar",
        "horns"
      ],
      "rhythm": "Groovy, backbeat",
      "harmony": "Rich, gospel-influenced",
      "other": "Emotional vocals"
    }
  },
  "Rock": {
    "subgenres": [
      "Active Rock",
      "Adult Album Alternative",
      "Afro Rock",
      "Album Oriented Rock",
      "American Rock",
      "Anatolian Rock",
      "Arabic Rock",
      "Arena Rock",
      "Blues Rock",
      "Boogie Rock",
      "Brazilian Rock",
      "Samba Rock",
      "British Rock Music",
      "Chinese Rock",
      "Christian Rock",
      "Classic Rock",
      "Comedy Rock",
      "Country Rock",
      "Dark Cabaret",
      "Death 'n' Roll",
      "Deathrock",
      "Desert Rock",
      "Emo",
      "Funk Rock",
      "Garage Rock",
      "Proto-Punk",
      "Geek Rock",
      "Glam Rock",
      "Gothic Rock",
      "Pagan Rock",
      "Hard Rock",
      "Heartland Rock",
      "Heavy Metal Music",
      "Proto-Metal",
      "Indian Rock",
      "Iranian Rock",
      "Instrumental Rock",
      "Japanese Rock",
      "Jazz Fusion",
      "Jazz Rock",
      "Korean Rock",
      "Mainstream Rock",
      "Mangue Bit",
      "Modern Rock",
      "New Wave of Classic Rock",
      "Occult Rock",
      "Pub Rock (Australia)",
      "Pub Rock (United Kingdom)",
      "Punk Rock",
      "Rap Rock",
      "Rapcore",
      "Reggae Fusion",
      "Reggae Rock",
      "Rock Music in France",
      "Rock Opera",
      "Roots Rock",
      "Southern Rock",
      "Stoner Rock",
      "Swamp Rock",
      "Sufi Rock",
      "Surf Rock",
      "Tropical Rock",
      "Turkish Rock",
      "Viking Rock",
      "Visual Kei",
      "Nagoya Kei",
      "Wizard Rock",
      "Worldbeat",
      "World Fusion",
      "Christian Metal",
      "Unblack Metal",
      "Extreme Metal",
      "Glam Metal",
      "Gothic Metal",
      "Grindcore",
      "Industrial Metal",
      "Kawaii Metal",
      "Latin Metal",
      "Mathcore",
      "Neoclassical Metal",
      "Neue Deutsche H\u00e4rte",
      "New Wave of American Heavy Metal",
      "New Wave of British Heavy Metal",
      "New Wave of Traditional Heavy Metal",
      "Nintendocore",
      "Pop Metal",
      "Power Metal",
      "Progressive Metal",
      "Djent",
      "Proto-Metal",
      "Sludge Metal",
      "Speed Metal",
      "Symphonic Metal"
    ],
    "features": {
      "tempo": "100-160 BPM",
      "instruments": [
        "electric guitar",
        "bass",
        "drums",
        "vocals"
      ],
      "rhythm": "Strong backbeat, 4/4",
      "harmony": "Power chords, distortions",
      "other": "Energetic, guitar-driven"
    }
  },
  "Punk": {
    "subgenres": [
      "Art Punk",
      "Britpunk",
      "Crossover Thrash",
      "Crust Punk",
      "Emotional Hardcore",
      "Folk Punk",
      "Hardcore Punk",
      "Punk",
      "Synth-Punk",
      "Punk Blues",
      "Psychobilly / Punkabilly",
      "Ska Punk",
      "Street Punk"
    ],
    "features": {
      "tempo": "140-200 BPM",
      "instruments": [
        "guitar",
        "bass",
        "drums"
      ],
      "rhythm": "Fast, aggressive",
      "harmony": "Simple, raw",
      "other": "Rebellious lyrics"
    }
  },
  "Reggae": {
    "subgenres": [
      "Dancehall",
      "Dub",
      "Dub Poetry",
      "Lovers Rock",
      "Ragga",
      "Raggamuffin",
      "Reggae",
      "Reggae Fusion",
      "Reggae Gospel",
      "Reggae Rock",
      "Roots Reggae",
      "Ska"
    ],
    "features": {
      "tempo": "60-90 BPM",
      "instruments": [
        "bass",
        "drums",
        "guitar",
        "organ"
      ],
      "rhythm": "Offbeat, skank",
      "harmony": "Simple, repetitive",
      "other": "Jamaican origins"
    }
  },
  "World": {
    "subgenres": [
      "African",
      "Afrobeat",
      "Afropop",
      "Apala",
      "Asian",
      "Assouk",
      "Australian Reggae",
      "Ax\u00e9",
      "Bachata",
      "Baithak Gana",
      "Balearic Beat",
      "Balkan",
      "Beat Music",
      "Beguine",
      "Benga",
      "Bhangra",
      "Big Beat",
      "Bolero",
      "Bomba",
      "Boogaloo",
      "Bosnova",
      "Bounce / New Orleans",
      "Calypso",
      "Caribbean",
      "Carnaval",
      "Celtic",
      "Cha Cha",
      "Choro",
      "Chowtal",
      "Chutney",
      "Chutney Parang",
      "Chutney Soca",
      "Classic Rock",
      "Compas",
      "Coup\u00e9-D\u00e9cal\u00e9",
      "Crunk",
      "Cumbia",
      "Dancehall",
      "Dansband",
      "Danz\u00f3n",
      "Descarga",
      "Dhamar",
      "Dhrupad",
      "Disco Polo",
      "Djing",
      "Drum & Bass",
      "Dub",
      "Dubstep",
      "Dunedin Sound",
      "Eastern",
      "Electro",
      "Electro Salsa",
      "Electronic",
      "Electronica",
      "Ethio-jazz",
      "Eurobeat",
      "Eurodance",
      "Europa",
      "Fado",
      "Flamenco",
      "Forr\u00f3",
      "Freestyle",
      "Funk Carioca",
      "Funky",
      "Gaita",
      "Garage",
      "Gwo Ka",
      "Highlife",
      "Hindustani",
      "Hi-NRG",
      "House",
      "Indian Ghazal",
      "Indian Pop",
      "Indo-Caribbean",
      "Italo Dance",
      "Italo Disco",
      "Japanese Pop",
      "Juju",
      "J\u00f9j\u00fa",
      "Kawaii Metal",
      "Kizomba",
      "Klasik",
      "Kuduro",
      "Kwela",
      "La\u00efk\u00f3",
      "Lambada",
      "Latin",
      "Latin Ballad",
      "Latin Jazz",
      "Latin Pop",
      "Luk Krung",
      "Luk Thung",
      "Mambo",
      "Maracatu",
      "Mariachi",
      "Mazurka",
      "Mbalax",
      "Mbaqanga",
      "Merengue",
      "Mizrahi Music",
      "Mor lam",
      "Morna",
      "MpB",
      "Musette",
      "New Age",
      "Palm-Wine",
      "Pasodoble",
      "Plena",
      "Polka",
      "Pop Sunda",
      "Quadrille",
      "Ra\u00ef",
      "Rasin",
      "Reggaeton",
      "Rocksteady",
      "Rumba",
      "Salsa",
      "Salsa Romantica",
      "Samba",
      "Schlager",
      "Semba",
      "Sertanejo",
      "Shaabi",
      "Shibuya-Kei",
      "Ska",
      "Skank",
      "Soca",
      "Son Cubano",
      "Soukous",
      "Tango",
      "Tarana",
      "Techno",
      "Thillana",
      "Timba",
      "Trance",
      "Twoubadou",
      "Vallenato",
      "Waila",
      "Wassoulou",
      "World Fusion",
      "Zessta",
      "Zouk",
      "Zydeco"
    ],
    "features": {
      "tempo": "Varied by region",
      "instruments": [
        "Traditional instruments per culture"
      ],
      "rhythm": "Cultural-specific patterns",
      "harmony": "Modal, pentatonic",
      "other": "Global influences"
    }
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   GENRE PROFILES
   Derived from the JSON features, converted to scoreable numeric ranges.
   Each profile defines:
     bpmRange       [min, max]
     complexity     0-1  (expected chord complexity)
     modes          array of expected modes
     blueNotes      bool
     syncopation    bool
     noteDensity    'low'|'medium'|'high'  (<2, 2-6, >6 notes/sec)
     velocityRange  'tight'|'wide'         (dynamic range)
     chordWeight    weight for chord complexity in scoring
   ═══════════════════════════════════════════════════════════════════════════ */
const GENRE_PROFILES = {
  'Classical': {
    bpmRange:    [60, 160],
    complexity:  0.5,
    modes:       ['major', 'minor'],
    blueNotes:   false,
    syncopation: false,
    noteDensity: 'medium',
    velocityRange: 'wide',
    tags: ['tonal', 'structured', 'orchestral'],
  },
  'Avant-garde & experimental': {
    bpmRange:    [0, 300],
    complexity:  0.9,
    modes:       ['atonal'],
    blueNotes:   false,
    syncopation: true,
    noteDensity: 'low',
    velocityRange: 'wide',
    tags: ['atonal', 'free'],
  },
  'Blues': {
    bpmRange:    [60, 120],
    complexity:  0.3,
    modes:       ['minor', 'blues', 'pentatonic'],
    blueNotes:   true,
    syncopation: true,
    noteDensity: 'medium',
    velocityRange: 'wide',
    tags: ['blue notes', 'swing', 'expressive'],
  },
  'Country': {
    bpmRange:    [80, 140],
    complexity:  0.1,
    modes:       ['major'],
    blueNotes:   false,
    syncopation: false,
    noteDensity: 'medium',
    velocityRange: 'tight',
    tags: ['major', 'simple', 'steady'],
  },
  'Easy Listening': {
    bpmRange:    [60, 100],
    complexity:  0.25,
    modes:       ['major'],
    blueNotes:   false,
    syncopation: false,
    noteDensity: 'low',
    velocityRange: 'tight',
    tags: ['consonant', 'smooth', 'relaxed'],
  },
  'Electronic': {
    bpmRange:    [100, 180],
    complexity:  0.2,
    modes:       ['minor', 'modal'],
    blueNotes:   false,
    syncopation: false,
    noteDensity: 'high',
    velocityRange: 'tight',
    tags: ['repetitive', 'electronic', 'loops'],
  },
  'Dance': {
    bpmRange:    [115, 180],
    complexity:  0.15,
    modes:       ['minor', 'major'],
    blueNotes:   false,
    syncopation: false,
    noteDensity: 'high',
    velocityRange: 'tight',
    tags: ['dance', 'repetitive', 'beat-driven'],
  },
  'Folk': {
    bpmRange:    [60, 120],
    complexity:  0.1,
    modes:       ['major', 'modal', 'dorian', 'mixolydian'],
    blueNotes:   false,
    syncopation: false,
    noteDensity: 'low',
    velocityRange: 'tight',
    tags: ['modal', 'acoustic', 'simple'],
  },
  'Hip-Hop/Rap': {
    bpmRange:    [60, 100],
    complexity:  0.2,
    modes:       ['minor'],
    blueNotes:   true,
    syncopation: true,
    noteDensity: 'low',
    velocityRange: 'tight',
    tags: ['syncopated', 'looped', 'backbeat'],
  },
  'Jazz': {
    bpmRange:    [60, 200],
    complexity:  0.8,
    modes:       ['major', 'minor', 'dorian', 'mixolydian'],
    blueNotes:   true,
    syncopation: true,
    noteDensity: 'high',
    velocityRange: 'wide',
    tags: ['complex chords', 'swing', 'improvisation'],
  },
  'Pop': {
    bpmRange:    [100, 130],
    complexity:  0.15,
    modes:       ['major'],
    blueNotes:   false,
    syncopation: false,
    noteDensity: 'medium',
    velocityRange: 'tight',
    tags: ['catchy', 'hook-based', 'simple'],
  },
  'R&B & Soul': {
    bpmRange:    [60, 120],
    complexity:  0.45,
    modes:       ['minor', 'dorian'],
    blueNotes:   true,
    syncopation: true,
    noteDensity: 'medium',
    velocityRange: 'wide',
    tags: ['gospel', 'groovy', 'expressive'],
  },
  'Rock': {
    bpmRange:    [100, 160],
    complexity:  0.2,
    modes:       ['major', 'minor', 'pentatonic'],
    blueNotes:   false,
    syncopation: false,
    noteDensity: 'medium',
    velocityRange: 'wide',
    tags: ['power chords', 'guitar-driven', 'backbeat'],
  },
  'Punk': {
    bpmRange:    [140, 200],
    complexity:  0.05,
    modes:       ['major', 'minor'],
    blueNotes:   false,
    syncopation: false,
    noteDensity: 'high',
    velocityRange: 'tight',
    tags: ['fast', 'simple', 'aggressive'],
  },
  'Reggae': {
    bpmRange:    [60, 90],
    complexity:  0.1,
    modes:       ['minor', 'major'],
    blueNotes:   false,
    syncopation: true,
    noteDensity: 'low',
    velocityRange: 'tight',
    tags: ['offbeat', 'relaxed', 'repetitive'],
  },
  'World': {
    bpmRange:    [60, 180],
    complexity:  0.3,
    modes:       ['modal', 'pentatonic', 'phrygian', 'dorian'],
    blueNotes:   false,
    syncopation: true,
    noteDensity: 'medium',
    velocityRange: 'wide',
    tags: ['modal', 'cultural', 'global'],
  },
};

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

/* ═══════════════════════════════════════════════════════════════════════════
   CLASSIFY
   Returns array of { genre, subgenre, score, confidence, key, bpm }
   sorted by score descending.
   ═══════════════════════════════════════════════════════════════════════════ */
export function classify(features) {
  const results = [];

  for (const [genre, profile] of Object.entries(GENRE_PROFILES)) {
    const score = scoreGenre(features, profile);
    results.push({ genre, score });
  }

  results.sort((a,b) => b.score - a.score);

  // Normalise scores to confidence percentages
  const top = results[0].score;
  const bottom = results[results.length - 1].score;
  const range = top - bottom || 1;

  const ranked = results.map(r => ({
    genre:      r.genre,
    score:      r.score,
    confidence: Math.round(((r.score - bottom) / range) * 100),
  }));

  // Annotate top result with musical context
  const topResult = ranked[0];
  const keyName   = NOTE_NAMES[features.key ?? 0];
  const modeName  = features.mode ?? '';
  const bpmStr    = features.bpm ? `${features.bpm} BPM` : '';
  const modeStr   = modeName !== 'major' && modeName !== 'minor'
                  ? modeName : `${keyName} ${modeName}`;

  return {
    top:     topResult.genre,
    second:  ranked[1]?.genre ?? '',
    third:   ranked[2]?.genre ?? '',
    ranked,
    context: [bpmStr, modeStr].filter(Boolean).join(' · '),
    key:     keyName,
    mode:    modeName,
    bpm:     features.bpm,
    subgenre: guessSubgenre(topResult.genre, features),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCORE A GENRE
   ═══════════════════════════════════════════════════════════════════════════ */
function scoreGenre(f, profile) {
  let score = 0;

  /* ── TEMPO (30%) ── */
  if (f.bpm !== null && f.bpm !== undefined) {
    const [lo, hi] = profile.bpmRange;
    const mid = (lo + hi) / 2;
    const bpmScore = f.bpm >= lo && f.bpm <= hi ? 1.0
                   : 1.0 - Math.min(1, Math.abs(f.bpm - clamp(f.bpm, lo, hi)) / 60);
    score += bpmScore * 0.30;
  } else {
    score += 0.15; // no BPM data — neutral
  }

  /* ── MODE MATCH (20%) ── */
  const modeScore = profile.modes.includes(f.mode) ? 1.0
                  : profile.modes.some(m => modesCompatible(m, f.mode)) ? 0.5 : 0.1;
  score += modeScore * 0.20;

  /* ── CHORD COMPLEXITY (20%) ── */
  const complexDiff = Math.abs(f.chordComplexity - profile.complexity);
  score += (1.0 - Math.min(1, complexDiff * 2)) * 0.20;

  /* ── BLUE NOTES (10%) ── */
  if (profile.blueNotes === f.hasBlueNotes) score += 0.10;
  else score += 0.02;

  /* ── SYNCOPATION (10%) ── */
  if (profile.syncopation === f.hasSyncopation) score += 0.10;
  else score += 0.02;

  /* ── NOTE DENSITY (10%) ── */
  const densityLabel = f.noteDensity < 2 ? 'low'
                     : f.noteDensity < 6 ? 'medium' : 'high';
  score += densityLabel === profile.noteDensity ? 0.10 : 0.02;

  return score;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function modesCompatible(profileMode, detectedMode) {
  const compat = {
    'major':  ['lydian', 'mixolydian', 'pentatonic'],
    'minor':  ['dorian', 'phrygian', 'blues', 'pentatonic'],
    'modal':  ['dorian', 'phrygian', 'lydian', 'mixolydian'],
  };
  return compat[profileMode]?.includes(detectedMode) ?? false;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SUBGENRE GUESSER
   After identifying the genre, try to narrow to a subgenre using
   the features + the subgenre list from music_styles.json.
   Currently uses simple keyword matching on mode + tempo + features.
   This is intentionally loose — a foundation for richer logic later.
   ═══════════════════════════════════════════════════════════════════════════ */
function guessSubgenre(genre, features) {
  const subgenres = STYLES[genre]?.subgenres ?? [];
  if (!subgenres.length) return null;

  // Build a set of tags from features
  const tags = new Set();
  if (features.bpm) {
    if (features.bpm < 80)  tags.add('slow');
    if (features.bpm > 140) tags.add('fast');
    if (features.bpm > 115 && features.bpm < 135) tags.add('house');
    if (features.bpm > 160) tags.add('hardcore');
  }
  if (features.mode === 'minor')      tags.add('dark');
  if (features.mode === 'dorian')     tags.add('folk');
  if (features.mode === 'blues')      tags.add('blues');
  if (features.hasBlueNotes)          tags.add('blues');
  if (features.hasSyncopation)        tags.add('swing');
  if (features.chordComplexity > 0.6) tags.add('complex');
  if (features.noteDensity > 6)       tags.add('dense');

  // Score each subgenre by keyword overlap
  const scored = subgenres.map(sg => {
    const words  = sg.toLowerCase().split(/[\s\/\-&]+/);
    const hits   = words.filter(w => tags.has(w)).length;
    return { sg, hits };
  }).sort((a,b) => b.hits - a.hits);

  // Return top hit only if it has at least one keyword match, else first subgenre
  return scored[0]?.hits > 0 ? scored[0].sg : subgenres[0];
}