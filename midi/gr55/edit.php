<?php
// edit.php — reads/writes content.json for the MIDI preset app
$FILE = __DIR__ . '/content.json';

// Handle save (POST JSON body) and exit before any HTML is emitted.
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json');
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);

    if (!is_array($data) || !isset($data['songs']) || !is_array($data['songs'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Invalid payload']);
        exit;
    }

    // Re-encode cleanly (pretty-printed) and write atomically.
    $out = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $tmp = $FILE . '.tmp';
    if (file_put_contents($tmp, $out) === false || !rename($tmp, $FILE)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Could not write content.json (check permissions)']);
        exit;
    }
    echo json_encode(['ok' => true]);
    exit;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MIDI Song Presets — Editor</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #1a1a1e;
    color: #e6e6ea;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    padding: 10px 16px;
    background: #24242a;
    border-bottom: 1px solid #34343c;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  header h1 { font-size: 16px; margin: 0; margin-right: auto; font-weight: 600; }
  header a { color: #7a9cff; font-size: 13px; text-decoration: none; }
  label { font-size: 13px; color: #9a9aa6; }
  select, input, textarea {
    background: #2e2e36;
    color: #e6e6ea;
    border: 1px solid #44444e;
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 13px;
    font-family: inherit;
  }
  button {
    background: #3457d5;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 7px 14px;
    font-size: 13px;
    cursor: pointer;
  }
  button:hover { background: #3f63e8; }
  button.secondary { background: #3a3a44; }
  button.secondary:hover { background: #45454f; }
  button.danger { background: #a63a3a; }
  button.danger:hover { background: #bd4444; }
  #status { font-size: 12px; padding: 3px 8px; border-radius: 4px; background: #3a2a2a; color: #ff9c9c; }
  #status.ok { background: #223a2a; color: #9cffb0; }
  main { flex: 1; display: flex; min-height: 0; }
  #list {
    width: 300px;
    border-right: 1px solid #34343c;
    overflow-y: auto;
    background: #202026;
    display: flex;
    flex-direction: column;
  }
  #listItems { flex: 1; overflow-y: auto; }
  .listFooter { padding: 10px; border-top: 1px solid #34343c; }
  .listFooter button { width: 100%; }
  .preset {
    padding: 12px 16px;
    cursor: pointer;
    border-bottom: 1px solid #2c2c34;
  }
  .preset:hover { background: #2a2a32; }
  .preset.active { background: #3457d5; }
  .preset .title { font-weight: 600; font-size: 15px; }
  .preset .artist { font-size: 12px; color: #9a9aa6; }
  .preset.active .artist { color: #cdd6ff; }
  #editor { flex: 1; padding: 24px 32px; overflow-y: auto; }
  #editor.hidden { display: none; }
  .empty { color: #6a6a76; padding: 28px 36px; }
  .field { margin-bottom: 16px; }
  .field label { display: block; margin-bottom: 5px; }
  .field input, .field textarea { width: 100%; }
  .field textarea { min-height: 220px; resize: vertical; line-height: 1.5; }
  .pcTable { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .pcTable th { text-align: left; font-size: 12px; color: #9a9aa6; font-weight: 500; padding: 4px 8px; }
  .pcTable td { padding: 4px 8px; }
  .pcTable input { width: 90px; }
  .rowActions { display: flex; gap: 8px; margin-top: 4px; }
  .editorActions { margin-top: 20px; display: flex; gap: 10px; align-items: center; }
  .dirty { color: #ffcf7a; font-size: 12px; }
  #lyricPreview {
    border: 1px solid #34343c;
    border-radius: 6px;
    padding: 16px;
    background: #202026;
    min-height: 80px;
    line-height: 1.6;
    white-space: pre-wrap;
  }
  #lyricPreview p { white-space: normal; margin: 0 0 1em; }
  #lyricPreview a { color: #7a9cff; }
  #lyricPreview img { max-width: 100%; height: auto; }
</style>
</head>
<body>
<header>
  <h1>Preset Editor</h1>
  <label>MIDI Output:</label>
  <select id="midiOut"><option>Loading…</option></select>
  <span id="status">MIDI not ready</span>
  <a href="index.html">↩ Player</a>
</header>
<main>
  <div id="list">
    <div id="listItems"></div>
    <div class="listFooter"><button id="addBtn">+ Add Song</button></div>
  </div>
  <div id="editor" class="hidden"></div>
  <div id="emptyMsg" class="empty">Select a song to edit, or add a new one.</div>
</main>

<script>
let midiAccess = null, midiOutput = null;
let songs = [];
let selected = -1;
let dirty = false;

const outSel = document.getElementById('midiOut');
const statusEl = document.getElementById('status');
const listItems = document.getElementById('listItems');
const editor = document.getElementById('editor');
const emptyMsg = document.getElementById('emptyMsg');

function setStatus(msg, ok) {
  statusEl.textContent = msg;
  statusEl.className = ok ? 'ok' : '';
}

/* ---------- MIDI ---------- */
async function initMIDI() {
  if (!navigator.requestMIDIAccess) { setStatus('Web MIDI not supported (use Chrome/Edge)', false); return; }
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    refreshOutputs();
    midiAccess.onstatechange = refreshOutputs;
  } catch (e) { setStatus('MIDI access denied', false); }
}
function refreshOutputs() {
  const outputs = [...midiAccess.outputs.values()];
  outSel.innerHTML = '';
  if (!outputs.length) {
    outSel.innerHTML = '<option>No MIDI outputs</option>';
    midiOutput = null; setStatus('No MIDI outputs found', false); return;
  }
  outputs.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.id; opt.textContent = o.name; outSel.appendChild(opt);
  });
  selectOutput(outputs[0].id);
}
function selectOutput(id) {
  midiOutput = midiAccess.outputs.get(id);
  outSel.value = id;
  setStatus('Ready: ' + (midiOutput ? midiOutput.name : ''), true);
}
outSel.addEventListener('change', e => selectOutput(e.target.value));

function sendProgramChanges(pcs) {
  if (!midiOutput) { setStatus('No MIDI output selected', false); return; }
  pcs.forEach(pc => {
    const ch = Math.max(1, Math.min(16, +pc.channel || 1)) - 1;
    const prog = Math.max(0, Math.min(127, +pc.program || 0));
    midiOutput.send([0xC0 | ch, prog]);
  });
  setStatus(`Sent ${pcs.length} program change(s)`, true);
}

/* ---------- Data / list ---------- */
function markDirty(state) {
  dirty = state;
  const d = document.getElementById('dirtyFlag');
  if (d) d.textContent = state ? '● unsaved changes' : '';
}

/* ---------- Safe HTML subset for lyrics (matches player) ---------- */
const ALLOWED_TAGS = ['B','STRONG','I','EM','U','S','BR','P','DIV','SPAN','H3','H4',
  'UL','OL','LI','BLOCKQUOTE','SMALL','MARK','SUP','SUB','HR','A','IMG'];
const ALLOWED_ATTR = { '*': ['style','class'], 'A': ['href','title'], 'IMG': ['src','alt','width','height'] };
const SAFE_STYLE = /^(color|background-color|font-size|font-weight|font-style|text-align|text-decoration|letter-spacing|line-height|margin|margin-top|margin-bottom|padding|opacity)\s*:\s*[^;{}()]+$/i;

function sanitizeHTML(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = node => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === 1) {
        if (!ALLOWED_TAGS.includes(child.tagName)) {
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
          return;
        }
        const allowed = (ALLOWED_ATTR['*'] || []).concat(ALLOWED_ATTR[child.tagName] || []);
        [...child.attributes].forEach(attr => {
          const name = attr.name.toLowerCase();
          if (name.startsWith('on') || !allowed.includes(name)) { child.removeAttribute(attr.name); return; }
          const val = attr.value.trim();
          if (name === 'style') {
            const clean = val.split(';').map(s => s.trim()).filter(s => s && SAFE_STYLE.test(s)).join('; ');
            if (clean) child.setAttribute('style', clean); else child.removeAttribute('style');
          } else if (name === 'href' || name === 'src') {
            if (/^\s*(javascript|data|vbscript):/i.test(val)) child.removeAttribute(attr.name);
          }
        });
        if (child.tagName === 'A') { child.setAttribute('target','_blank'); child.setAttribute('rel','noopener noreferrer'); }
        walk(child);
      } else if (child.nodeType === 8) {
        node.removeChild(child);
      }
    });
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

function renderList() {
  listItems.innerHTML = '';
  songs.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'preset' + (i === selected ? ' active' : '');
    div.dataset.idx = i;
    div.innerHTML = `<div class="title"></div><div class="artist"></div>`;
    div.querySelector('.title').textContent = s.title || '(untitled)';
    div.querySelector('.artist').textContent = s.artist || '';
    div.addEventListener('click', () => selectSong(i));
    listItems.appendChild(div);
  });
}

function selectSong(i) {
  selected = i;
  renderList();
  renderEditor();
}

/* ---------- Editor ---------- */
function renderEditor() {
  if (selected < 0 || !songs[selected]) {
    editor.classList.add('hidden');
    emptyMsg.style.display = '';
    return;
  }
  emptyMsg.style.display = 'none';
  editor.classList.remove('hidden');
  const s = songs[selected];

  editor.innerHTML = `
    <div class="field">
      <label>Title</label>
      <input id="fTitle" type="text" value="">
    </div>
    <div class="field">
      <label>Artist</label>
      <input id="fArtist" type="text" value="">
    </div>
    <div class="field">
      <label>Program Changes</label>
      <table class="pcTable">
        <thead><tr><th>Channel (1–16)</th><th>Program (0–127)</th><th></th></tr></thead>
        <tbody id="pcBody"></tbody>
      </table>
      <div class="rowActions">
        <button class="secondary" id="addPcBtn">+ Add Change</button>
        <button class="secondary" id="testBtn">▶ Test Send</button>
      </div>
    </div>
    <div class="field">
      <label>Lyrics <small style="color:#7a7a86;">— allowed: b, i, u, s, br, p, div, span, h3, h4, ul/ol/li, blockquote, small, mark, sup, sub, hr, a, img (style/class attrs)</small></label>
      <textarea id="fLyrics" spellcheck="false"></textarea>
    </div>
    <div class="field">
      <label>Preview</label>
      <div id="lyricPreview" class="lyricBody"></div>
    </div>
    <div class="editorActions">
      <button id="saveBtn">Save to content.json</button>
      <button class="danger" id="deleteBtn">Delete</button>
      <span id="dirtyFlag" class="dirty"></span>
    </div>
  `;

  document.getElementById('fTitle').value = s.title || '';
  document.getElementById('fArtist').value = s.artist || '';
  document.getElementById('fLyrics').value = s.lyrics || '';

  document.getElementById('fTitle').addEventListener('input', e => { s.title = e.target.value; markDirty(true); renderList(); });
  document.getElementById('fArtist').addEventListener('input', e => { s.artist = e.target.value; markDirty(true); renderList(); });
  const updatePreview = () => { document.getElementById('lyricPreview').innerHTML = sanitizeHTML(s.lyrics || ''); };
  document.getElementById('fLyrics').addEventListener('input', e => { s.lyrics = e.target.value; markDirty(true); updatePreview(); });
  updatePreview();

  renderPcRows();
  document.getElementById('addPcBtn').addEventListener('click', () => {
    s.programChanges = s.programChanges || [];
    s.programChanges.push({ channel: 1, program: 0 });
    markDirty(true); renderPcRows();
  });
  document.getElementById('testBtn').addEventListener('click', () => sendProgramChanges(s.programChanges || []));
  document.getElementById('saveBtn').addEventListener('click', save);
  document.getElementById('deleteBtn').addEventListener('click', deleteSong);
  markDirty(dirty);
}

function renderPcRows() {
  const s = songs[selected];
  const body = document.getElementById('pcBody');
  body.innerHTML = '';
  (s.programChanges || []).forEach((pc, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="number" min="1" max="16" class="pcCh"></td>
      <td><input type="number" min="0" max="127" class="pcProg"></td>
      <td><button class="danger pcDel">✕</button></td>
    `;
    tr.querySelector('.pcCh').value = pc.channel;
    tr.querySelector('.pcProg').value = pc.program;
    tr.querySelector('.pcCh').addEventListener('input', e => { pc.channel = +e.target.value; markDirty(true); });
    tr.querySelector('.pcProg').addEventListener('input', e => { pc.program = +e.target.value; markDirty(true); });
    tr.querySelector('.pcDel').addEventListener('click', () => {
      s.programChanges.splice(idx, 1); markDirty(true); renderPcRows();
    });
    body.appendChild(tr);
  });
}

/* ---------- Actions ---------- */
function addSong() {
  songs.push({ title: 'New Song', artist: '', lyrics: '', programChanges: [{ channel: 1, program: 0 }] });
  selected = songs.length - 1;
  markDirty(true);
  renderList();
  renderEditor();
}

function deleteSong() {
  if (selected < 0) return;
  const s = songs[selected];
  if (!confirm(`Delete "${s.title || 'this song'}"?`)) return;
  songs.splice(selected, 1);
  selected = Math.min(selected, songs.length - 1);
  markDirty(true);
  renderList();
  renderEditor();
}

async function save() {
  // sanitize program changes to plain ints within range
  songs.forEach(s => {
    s.programChanges = (s.programChanges || []).map(pc => ({
      channel: Math.max(1, Math.min(16, parseInt(pc.channel) || 1)),
      program: Math.max(0, Math.min(127, parseInt(pc.program) || 0))
    }));
  });
  try {
    const res = await fetch(window.location.pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songs }, null, 2)
    });
    const result = await res.json();
    if (result.ok) { markDirty(false); setStatus('Saved content.json', true); }
    else setStatus('Save failed: ' + (result.error || 'unknown'), false);
  } catch (e) {
    setStatus('Save failed: ' + e.message, false);
  }
}

document.getElementById('addBtn').addEventListener('click', addSong);

window.addEventListener('beforeunload', e => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

async function loadContent() {
  try {
    const res = await fetch('content.json?_=' + Date.now());
    const data = await res.json();
    songs = data.songs || [];
  } catch (e) {
    songs = [];
    setStatus('Could not load content.json (starting empty)', false);
  }
  renderList();
}

initMIDI();
loadContent();
</script>
</body>
</html>