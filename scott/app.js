// Video browser — reads videos.json (NDJSON: one JSON object per line)
// and lets you watch each one via YouTube or Rumble embed.

let videos = [];
let filtered = [];
let currentIndex = -1;
let currentSource = 'youtube'; // default preference

const $list = document.getElementById('list');
const $search = document.getElementById('search');
const $count = document.getElementById('count');
const $title = document.getElementById('title');
const $player = document.getElementById('player');
const $toggle = document.getElementById('source-toggle');

// ---------- Load ----------
async function load() {
  try {
    const res = await fetch('/scott/videos.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    videos = text
      .split('\n')
      .filter(l => l.trim())
      .map(l => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
    filtered = videos.slice();
    render();
  } catch (err) {
    $list.innerHTML =
      `<div style="padding:16px;color:#ff7676;font-size:13px">
        Could not load videos.json: ${err.message}<br><br>
        This page must be served over HTTP (e.g. <code>python3 -m http.server</code>),
        not opened directly via file://, because of browser fetch restrictions.
       </div>`;
  }
}

// ---------- Render list ----------
function render() {
  $count.textContent = `${filtered.length} of ${videos.length}`;
  if (filtered.length === 0) {
    $list.innerHTML = '<div style="padding:16px;color:#8a93a3;font-size:13px">No matches.</div>';
    return;
  }

  // Build DOM (faster than innerHTML for hundreds of nodes with images)
  const frag = document.createDocumentFragment();
  filtered.forEach((v) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = v._id?.$oid || v.rumble_id;

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = v.thumb || '';
    img.alt = '';
    img.onerror = () => { img.style.visibility = 'hidden'; };

    const meta = document.createElement('div');
    meta.className = 'meta';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = v.title || '(untitled)';

    const ids = document.createElement('div');
    ids.className = 'ids';
    if (v.yt_id) {
      const b = document.createElement('span');
      b.className = 'badge yt';
      b.textContent = 'YT';
      ids.appendChild(b);
    }
    if (v.rumble_id) {
      const b = document.createElement('span');
      b.className = 'badge rb';
      b.textContent = 'RB';
      ids.appendChild(b);
    }

    meta.appendChild(title);
    meta.appendChild(ids);
    card.appendChild(img);
    card.appendChild(meta);

    card.addEventListener('click', () => select(videos.indexOf(v)));
    frag.appendChild(card);
  });

  $list.innerHTML = '';
  $list.appendChild(frag);
  highlightActive();
}

function highlightActive() {
  const active = videos[currentIndex];
  if (!active) return;
  const id = active._id?.$oid || active.rumble_id;
  $list.querySelectorAll('.card').forEach(c => {
    c.classList.toggle('active', c.dataset.id === id);
  });
}

// ---------- Select & play ----------
function select(idx) {
  if (idx < 0 || idx >= videos.length) return;
  currentIndex = idx;
  const v = videos[idx];

  $title.textContent = v.title || '(untitled)';

  // Update toggle button availability
  const ytBtn = $toggle.querySelector('[data-src="youtube"]');
  const rbBtn = $toggle.querySelector('[data-src="rumble"]');
  ytBtn.disabled = !v.yt_id;
  rbBtn.disabled = !v.rumble_id;

  // Pick source: keep current preference if available, else fall back
  let src = currentSource;
  if (src === 'youtube' && !v.yt_id) src = 'rumble';
  if (src === 'rumble' && !v.rumble_id) src = 'youtube';

  setSource(src);
  highlightActive();

  // Scroll the active card into view if it's offscreen
  const activeCard = $list.querySelector('.card.active');
  if (activeCard) activeCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function setSource(src) {
  currentSource = src;
  const v = videos[currentIndex];
  if (!v) return;

  $toggle.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.src === src);
  });

  let embedUrl = '';
  if (src === 'youtube' && v.yt_id) {
    embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(v.yt_id)}`;
  } else if (src === 'rumble' && v.rumble_id) {
    embedUrl = `https://rumble.com/embed/${encodeURIComponent(v.rumble_id)}/`;
  }

  if (!embedUrl) {
    $player.innerHTML = '<div class="empty">No embed available for this source.</div>';
    return;
  }

  // Replace iframe (creating a new one is the simplest way to stop previous playback)
  $player.innerHTML = '';
  const iframe = document.createElement('iframe');
  iframe.className = 'player-frame';
  iframe.src = embedUrl;
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'no-referrer-when-downgrade';
  $player.appendChild(iframe);
}

// ---------- Search ----------
$search.addEventListener('input', () => {
  const q = $search.value.trim().toLowerCase();
  filtered = q
    ? videos.filter(v => (v.title || '').toLowerCase().includes(q))
    : videos.slice();
  render();
});

// ---------- Toggle clicks ----------
$toggle.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn || btn.disabled) return;
  setSource(btn.dataset.src);
});

load();