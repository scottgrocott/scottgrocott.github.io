<?php
// ============================================================
//  editor.php — Drone Wars Level Editor SPA
//  Run alongside index.html. Generates JS/JSON config you
//  paste into your game. No framework, no build step.
// ============================================================

header('Content-Type: text/html; charset=utf-8');

// ---- Handle AJAX save (POST) ----
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';

    if ($action === 'save_shelters') {
        $data = $_POST['data'] ?? '';
        $file = __DIR__ . '/editor_shelters.json';
        file_put_contents($file, $data);
        echo json_encode(['ok' => true, 'file' => 'editor_shelters.json']);
        exit;
    }

    if ($action === 'load_shelters') {
        $file = __DIR__ . '/editor_shelters.json';
        echo file_exists($file) ? file_get_contents($file) : '[]';
        exit;
    }

    if ($action === 'clear_shelters') {
        $file = __DIR__ . '/editor_shelters.json';
        file_put_contents($file, '[]');
        echo json_encode(['ok' => true]);
        exit;
    }

    if ($action === 'save_design') {
        $data = $_POST['data'] ?? '';
        $file = __DIR__ . '/editor_designs.json';
        // Merge into existing library
        $lib  = file_exists($file) ? json_decode(file_get_contents($file), true) : [];
        if (!is_array($lib)) $lib = [];
        $design = json_decode($data, true);
        if ($design && isset($design['name'])) {
            // Overwrite if same name exists
            $lib = array_filter($lib, fn($d) => $d['name'] !== $design['name']);
            $lib = array_values($lib);
            $lib[] = $design;
            file_put_contents($file, json_encode($lib, JSON_PRETTY_PRINT));
            echo json_encode(['ok' => true, 'count' => count($lib)]);
        } else {
            echo json_encode(['error' => 'Invalid design data']);
        }
        exit;
    }

    if ($action === 'save_designs_bulk') {
        $data = $_POST['data'] ?? '';
        $file = __DIR__ . '/editor_designs.json';
        file_put_contents($file, $data);
        echo json_encode(['ok' => true]);
        exit;
    }

    if ($action === 'load_designs') {
        $file = __DIR__ . '/editor_designs.json';
        echo file_exists($file) ? file_get_contents($file) : '[]';
        exit;
    }

    if ($action === 'delete_design') {
        $name = $_POST['name'] ?? '';
        $file = __DIR__ . '/editor_designs.json';
        $lib  = file_exists($file) ? json_decode(file_get_contents($file), true) : [];
        if (!is_array($lib)) $lib = [];
        $lib  = array_values(array_filter($lib, fn($d) => $d['name'] !== $name));
        file_put_contents($file, json_encode($lib, JSON_PRETTY_PRINT));
        echo json_encode(['ok' => true, 'count' => count($lib)]);
        exit;
    }

    echo json_encode(['error' => 'Unknown action']);
    exit;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Drone Wars — Level Editor</title>
<style>
  /* ---- Reset + Base ---- */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg0:    #050a05;
    --bg1:    #0a120a;
    --bg2:    #0f1a0f;
    --bg3:    #172217;
    --border: #253525;
    --green0: #3a6a3a;
    --green1: #5aaa5a;
    --green2: #8aee8a;
    --green3: #c8ffc8;
    --amber:  #ffcc44;
    --red:    #ee5544;
    --blue:   #5599ee;
    --dim:    #4a6a4a;
    --font:   'Courier New', Courier, monospace;
  }

  html, body {
    height: 100%; background: var(--bg0); color: var(--green2);
    font-family: var(--font); font-size: 13px; line-height: 1.5;
    overflow: hidden;
  }

  /* ---- Layout ---- */
  #app {
    display: grid;
    grid-template-rows: 42px 1fr;
    grid-template-columns: 220px 1fr 280px;
    height: 100vh;
    gap: 0;
  }

  /* ---- Header ---- */
  #header {
    grid-column: 1 / -1;
    display: flex; align-items: center; gap: 16px;
    padding: 0 16px;
    background: var(--bg1);
    border-bottom: 1px solid var(--border);
  }
  #header h1 {
    font-size: 13px; letter-spacing: 0.2em;
    text-transform: uppercase; color: var(--green2);
  }
  #header h1 span { color: var(--amber); }
  .hdr-tag {
    font-size: 9px; letter-spacing: 0.15em;
    color: var(--dim); text-transform: uppercase;
    border: 1px solid var(--border); padding: 2px 6px; border-radius: 2px;
  }
  #status-bar {
    margin-left: auto; font-size: 10px;
    color: var(--dim); letter-spacing: 0.08em;
  }
  #status-bar span { color: var(--green1); }

  /* ---- Panels ---- */
  .panel {
    background: var(--bg1);
    border-right: 1px solid var(--border);
    overflow-y: auto; padding: 12px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .panel:last-child { border-right: none; border-left: 1px solid var(--border); }

  /* ---- Section ---- */
  .section { display: flex; flex-direction: column; gap: 6px; }
  .section-title {
    font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase;
    color: var(--dim); border-bottom: 1px solid var(--border);
    padding-bottom: 4px; margin-bottom: 2px;
  }

  /* ---- Form elements ---- */
  label { font-size: 10px; color: var(--dim); letter-spacing: 0.08em; }
  input[type=text], input[type=number], textarea, select {
    width: 100%; padding: 4px 7px;
    background: var(--bg0); border: 1px solid var(--border);
    color: var(--green2); font-family: var(--font); font-size: 11px;
    border-radius: 2px; outline: none;
  }
  input:focus, textarea:focus, select:focus {
    border-color: var(--green0); box-shadow: 0 0 0 1px var(--green0);
  }
  textarea { resize: vertical; min-height: 80px; }

  /* ---- Buttons ---- */
  .btn {
    padding: 5px 10px; background: var(--bg2);
    border: 1px solid var(--green0); color: var(--green2);
    font-family: var(--font); font-size: 10px;
    letter-spacing: 0.1em; text-transform: uppercase;
    cursor: pointer; border-radius: 2px;
    transition: background 0.15s, color 0.15s;
    text-align: left;
  }
  .btn:hover  { background: var(--bg3); color: var(--green3); }
  .btn.full   { width: 100%; }
  .btn.amber  { border-color: #886600; color: var(--amber); }
  .btn.amber:hover { background: #1a1400; }
  .btn.red    { border-color: #882200; color: var(--red); }
  .btn.red:hover   { background: #1a0500; }
  .btn.blue   { border-color: #224488; color: var(--blue); }
  .btn.blue:hover  { background: #0a1020; }

  /* ---- Main canvas area ---- */
  #main {
    background: var(--bg0);
    display: flex; flex-direction: column;
    overflow: hidden;
  }

  /* ---- Tab bar ---- */
  #tabs {
    display: flex; border-bottom: 1px solid var(--border);
    background: var(--bg1); padding: 0 8px;
  }
  .tab {
    padding: 8px 14px; font-size: 10px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--dim);
    cursor: pointer; border-bottom: 2px solid transparent;
    transition: color 0.15s;
  }
  .tab:hover { color: var(--green2); }
  .tab.active { color: var(--green2); border-bottom-color: var(--green1); }

  /* ---- Tab content ---- */
  .tab-content { display: none; flex: 1; overflow: auto; padding: 12px; }
  .tab-content.active { display: flex; flex-direction: column; gap: 10px; }

  /* ---- Shelter list ---- */
  #shelter-list {
    flex: 1; overflow-y: auto;
    border: 1px solid var(--border); border-radius: 2px;
  }
  .shelter-row {
    display: grid; grid-template-columns: 32px 1fr auto;
    align-items: center; gap: 8px;
    padding: 6px 10px; border-bottom: 1px solid var(--border);
    font-size: 11px;
  }
  .shelter-row:last-child { border-bottom: none; }
  .shelter-row:hover { background: var(--bg2); }
  .shelter-row .idx { color: var(--dim); font-size: 10px; }
  .shelter-row .pos { color: var(--green2); font-size: 10px; }
  .shelter-row .del {
    color: var(--red); cursor: pointer; font-size: 12px;
    padding: 2px 6px; border: 1px solid transparent;
    border-radius: 2px;
  }
  .shelter-row .del:hover { border-color: #882200; background: #1a0500; }

  /* ---- Output / code box ---- */
  .code-box {
    background: var(--bg0); border: 1px solid var(--border);
    padding: 8px; font-size: 11px; color: var(--green1);
    border-radius: 2px; white-space: pre; overflow: auto;
    min-height: 120px; max-height: 280px;
  }

  /* ---- Log ---- */
  #log {
    height: 80px; overflow-y: auto;
    border: 1px solid var(--border); padding: 4px 8px;
    font-size: 10px; color: var(--dim); border-radius: 2px;
  }
  #log .line { padding: 1px 0; }
  #log .line.ok  { color: var(--green1); }
  #log .line.err { color: var(--red); }
  #log .line.info { color: var(--amber); }

  /* ---- Scrollbar ---- */
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: var(--bg0); }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
</style>
</head>
<body>
<div id="app">

  <!-- Header -->
  <header id="header">
    <h1>DRONE WARS <span>//</span> LEVEL EDITOR</h1>
    <div class="hdr-tag">PHP SPA</div>
    <div id="status-bar">Shelters: <span id="hdr-count">0</span> &nbsp;|&nbsp; <span id="hdr-time">—</span></div>
  </header>

  <!-- Left panel: tools -->
  <aside class="panel">

    <div class="section">
      <div class="section-title">Add Shelter</div>
      <label>X</label>
      <input type="number" id="sh-x" step="0.1" placeholder="0.00">
      <label>Y</label>
      <input type="number" id="sh-y" step="0.1" placeholder="0.00">
      <label>Z</label>
      <input type="number" id="sh-z" step="0.1" placeholder="0.00">
      <label>Label (optional)</label>
      <input type="text" id="sh-label" placeholder="e.g. shelter_alpha">
      <button class="btn full" onclick="addShelter()">+ Add Shelter</button>
    </div>

    <div class="section">
      <div class="section-title">Paste from Game</div>
      <textarea id="paste-in" placeholder='Paste position string here&#10;e.g. 12.34, 2.10, -45.67'></textarea>
      <button class="btn full amber" onclick="pasteFromGame()">↓ Import Position</button>
    </div>

    <div class="section">
      <div class="section-title">File</div>
      <button class="btn full" onclick="saveShelters()">💾 Save to Server</button>
      <button class="btn full" onclick="loadShelters()">📂 Load from Server</button>
      <button class="btn full red" onclick="clearAll()">✕ Clear All</button>
    </div>

  </aside>

  <!-- Main area -->
  <main id="main">
    <div id="tabs">
      <div class="tab active" onclick="switchTab('shelters')">Shelters</div>
      <div class="tab" onclick="switchTab('output')">JS Output</div>
      <div class="tab" onclick="switchTab('json')">Scene JSON</div>
      <div class="tab" onclick="switchTab('designs')">Designs</div>
    </div>

    <!-- Tab: Shelters -->
    <div class="tab-content active" id="tab-shelters">
      <div style="display:flex;gap:8px;align-items:center">
        <span style="font-size:10px;color:var(--dim)">PLACED SHELTERS</span>
        <span id="count-badge" style="font-size:10px;color:var(--amber)">0</span>
        <button class="btn blue" style="margin-left:auto" onclick="generateAll()">↻ Refresh Output</button>
      </div>
      <div id="shelter-list"></div>
      <div id="log"></div>
    </div>

    <!-- Tab: JS Output -->
    <div class="tab-content" id="tab-output">
      <div class="section-title">Paste into main.js or shelters bootstrap</div>
      <div class="code-box" id="js-output">// Click "Refresh Output" to generate…</div>
      <button class="btn full" onclick="copyCode('js-output')">Copy JS</button>
    </div>

    <!-- Tab: Scene JSON -->
    <div class="tab-content" id="tab-json">
      <div class="section-title">Paste into drone_wars_assets_dev.json → "shelters" array</div>
      <div class="code-box" id="json-output">// Click "Refresh Output" to generate…</div>
      <button class="btn full" onclick="copyCode('json-output')">Copy JSON</button>
    </div>

    <!-- Tab: Design Library -->
    <div class="tab-content" id="tab-designs">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <span style="font-size:10px;color:var(--dim)">DESIGN LIBRARY</span>
        <span id="design-count" style="font-size:10px;color:var(--amber)">0</span>
        <button class="btn blue" style="margin-left:auto;padding:3px 8px" onclick="loadDesigns()">↻ Load from Server</button>
      </div>

      <div style="display:flex;gap:4px;margin-bottom:8px">
        <textarea id="paste-design" placeholder="Paste design JSON from game here…"
          style="flex:1;height:60px;background:var(--bg0);border:1px solid var(--border);
          color:var(--green2);font-family:var(--font);font-size:10px;padding:4px;resize:none;border-radius:2px"></textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px">
        <button class="btn" onclick="importDesignFromPaste()">↓ Import Pasted</button>
        <button class="btn blue" onclick="saveAllDesigns()">💾 Save All to Server</button>
      </div>

      <div id="design-list" style="flex:1;overflow-y:auto;border:1px solid var(--border);border-radius:2px;min-height:120px"></div>

      <div class="section-title" style="margin-top:8px">Spawn JS (copy → paste into game console)</div>
      <div class="code-box" id="design-spawn-out" style="min-height:60px;font-size:10px">—</div>
      <button class="btn full" onclick="copyCode('design-spawn-out')">Copy Spawn JS</button>

      <div id="log" style="display:none"></div>
    </div>
  </main>

  <!-- Right panel: inspector -->
  <aside class="panel">
    <div class="section">
      <div class="section-title">Selected Shelter</div>
      <div id="inspector" style="color:var(--dim);font-size:10px">Nothing selected.</div>
    </div>
    <div class="section">
      <div class="section-title">Edit Position</div>
      <label>X</label><input type="number" id="ins-x" step="0.1" oninput="updateSelected()">
      <label>Y</label><input type="number" id="ins-y" step="0.1" oninput="updateSelected()">
      <label>Z</label><input type="number" id="ins-z" step="0.1" oninput="updateSelected()">
      <label>Label</label><input type="text" id="ins-label" oninput="updateSelected()">
    </div>
    <div class="section">
      <div class="section-title">Quick Snippet</div>
      <div class="code-box" id="ins-snippet" style="min-height:60px;font-size:10px">—</div>
      <button class="btn full" onclick="copyCode('ins-snippet')">Copy</button>
    </div>
  </aside>

</div>

<script>
// ============================================================
//  State
// ============================================================
let shelterData  = [];   // [{ id, x, y, z, label }]
let selectedId   = null;
let _nextId      = 1;

// ============================================================
//  Shelter CRUD
// ============================================================

function addShelter(x, y, z, label) {
  x     = parseFloat(x !== undefined ? x : document.getElementById('sh-x').value)     || 0;
  y     = parseFloat(y !== undefined ? y : document.getElementById('sh-y').value)     || 0;
  z     = parseFloat(z !== undefined ? z : document.getElementById('sh-z').value)     || 0;
  label = (label !== undefined && label !== null) ? label : (document.getElementById('sh-label').value || ('shelter_' + _nextId));

  const s = { id: _nextId++, x, y, z, label };
  shelterData.push(s);
  renderList();
  selectShelter(s.id);
  _log(`Added ${label} at (${x}, ${y}, ${z})`, 'ok');
  generateAll();
}

function removeShelter(id) {
  shelterData = shelterData.filter(s => s.id !== id);
  if (selectedId === id) { selectedId = null; clearInspector(); }
  renderList();
  generateAll();
  _log(`Removed shelter #${id}`, 'err');
}

function updateSelected() {
  if (!selectedId) return;
  const s = shelterData.find(s => s.id === selectedId);
  if (!s) return;
  s.x     = parseFloat(document.getElementById('ins-x').value)     || s.x;
  s.y     = parseFloat(document.getElementById('ins-y').value)     || s.y;
  s.z     = parseFloat(document.getElementById('ins-z').value)     || s.z;
  s.label = document.getElementById('ins-label').value || s.label;
  renderList();
  updateSnippet(s);
  generateAll();
}

function selectShelter(id) {
  selectedId = id;
  const s    = shelterData.find(s => s.id === id);
  if (!s) return;
  document.getElementById('ins-x').value     = s.x;
  document.getElementById('ins-y').value     = s.y;
  document.getElementById('ins-z').value     = s.z;
  document.getElementById('ins-label').value = s.label;
  document.getElementById('inspector').textContent = `#${s.id} — ${s.label}`;
  updateSnippet(s);
}

function clearInspector() {
  ['ins-x','ins-y','ins-z','ins-label'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('inspector').textContent = 'Nothing selected.';
  document.getElementById('ins-snippet').textContent = '—';
}

function updateSnippet(s) {
  document.getElementById('ins-snippet').textContent =
    `createShelter({ x: ${s.x}, y: ${s.y}, z: ${s.z} });`;
}

// ============================================================
//  Paste from game
// ============================================================

function pasteFromGame() {
  const raw = document.getElementById('paste-in').value.trim();
  // Expect "x, y, z"  or  "x y z"  or  JSON {x,y,z}
  let x, y, z;
  try {
    if (raw.startsWith('{')) {
      const obj = JSON.parse(raw);
      x = obj.x; y = obj.y; z = obj.z;
    } else {
      const parts = raw.split(/[\s,]+/).map(Number);
      [x, y, z] = parts;
    }
    if ([x,y,z].some(isNaN)) throw new Error('Bad values');
    document.getElementById('sh-x').value = x.toFixed(3);
    document.getElementById('sh-y').value = y.toFixed(3);
    document.getElementById('sh-z').value = z.toFixed(3);
    _log(`Imported: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`, 'info');
  } catch(e) {
    _log(`Parse error: ${e.message}`, 'err');
  }
}

// ============================================================
//  Code generation
// ============================================================

function generateAll() {
  // JS
  const js = shelterData.length
    ? `// Auto-generated shelter placements\n` +
      shelterData.map(s =>
        `createShelter({ x: ${s.x.toFixed(3)}, y: ${s.y.toFixed(3)}, z: ${s.z.toFixed(3)} }); // ${s.label}`
      ).join('\n')
    : '// No shelters defined';
  document.getElementById('js-output').textContent = js;

  // JSON
  const json = JSON.stringify(
    shelterData.map(s => ({ type: 'shelter', label: s.label, position: { x: s.x, y: s.y, z: s.z } })),
    null, 2
  );
  document.getElementById('json-output').textContent = json;

  document.getElementById('count-badge').textContent = shelterData.length;
  document.getElementById('hdr-count').textContent   = shelterData.length;
}

// ============================================================
//  Render list
// ============================================================

function renderList() {
  const list = document.getElementById('shelter-list');
  list.innerHTML = '';
  if (!shelterData.length) {
    list.innerHTML = '<div style="padding:12px;color:var(--dim);font-size:10px">No shelters. Add one using the panel →</div>';
    return;
  }
  shelterData.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'shelter-row';
    row.innerHTML = `
      <span class="idx">#${i + 1}</span>
      <span class="pos">${s.label}<br><span style="color:var(--dim)">${s.x.toFixed(2)}, ${s.y.toFixed(2)}, ${s.z.toFixed(2)}</span></span>
      <span class="del" onclick="removeShelter(${s.id})" title="Delete">✕</span>
    `;
    row.addEventListener('click', e => { if (!e.target.classList.contains('del')) selectShelter(s.id); });
    if (s.id === selectedId) row.style.background = 'var(--bg3)';
    list.appendChild(row);
  });
}

// ============================================================
//  Server save/load
// ============================================================

async function saveShelters() {
  try {
    const res  = await fetch('editor.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `action=save_shelters&data=${encodeURIComponent(JSON.stringify(shelterData))}`,
    });
    const json = await res.json();
    _log(json.ok ? `Saved to ${json.file}` : `Save error: ${json.error}`, json.ok ? 'ok' : 'err');
  } catch(e) { _log(`Save failed: ${e.message}`, 'err'); }
}

async function loadShelters() {
  try {
    const res  = await fetch('editor.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=load_shelters',
    });
    const data = await res.json();
    shelterData = data.map(s => ({ ...s, id: _nextId++ }));
    renderList();
    generateAll();
    _log(`Loaded ${shelterData.length} shelter(s)`, 'ok');
  } catch(e) { _log(`Load failed: ${e.message}`, 'err'); }
}

async function clearAll() {
  if (!confirm('Clear all shelters?')) return;
  shelterData = [];
  selectedId  = null;
  clearInspector();
  renderList();
  generateAll();
  try {
    await fetch('editor.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=clear_shelters',
    });
    _log('Cleared.', 'err');
  } catch(e) {}
}

// ============================================================
//  UI helpers
// ============================================================

function copyCode(elId) {
  const text = document.getElementById(elId).textContent;
  navigator.clipboard?.writeText(text);
  _log('Copied to clipboard.', 'info');
}

function _log(msg, type = '') {
  const log  = document.getElementById('log');
  const line = document.createElement('div');
  line.className = `line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

// ============================================================
//  Design Library
// ============================================================

let designLib = [];

function importDesignFromPaste() {
  const raw = document.getElementById('paste-design').value.trim();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    // Accept single design or array
    const items = Array.isArray(parsed) ? parsed : [parsed];
    let added = 0;
    for (const d of items) {
      if (!d.name || !d.parts) { _log('Skipped invalid design', 'err'); continue; }
      const idx = designLib.findIndex(x => x.name === d.name);
      if (idx >= 0) designLib[idx] = d;
      else          designLib.push(d);
      added++;
    }
    renderDesignList();
    document.getElementById('paste-design').value = '';
    _log('Imported ' + added + ' design(s)', 'ok');
  } catch(e) {
    _log('Parse error: ' + e.message, 'err');
  }
}

async function loadDesigns() {
  try {
    const res  = await fetch('editor.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=load_designs',
    });
    designLib = await res.json();
    renderDesignList();
    _log('Loaded ' + designLib.length + ' design(s)', 'ok');
  } catch(e) { _log('Load failed: ' + e.message, 'err'); }
}

async function saveAllDesigns() {
  try {
    const res  = await fetch('editor.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=save_designs_bulk&data=' + encodeURIComponent(JSON.stringify(designLib)),
    });
    const json = await res.json();
    _log(json.ok ? 'Saved ' + designLib.length + ' designs' : ('Error: ' + json.error),
         json.ok ? 'ok' : 'err');
  } catch(e) { _log('Save failed: ' + e.message, 'err'); }
}

async function deleteDesign(name) {
  designLib = designLib.filter(d => d.name !== name);
  renderDesignList();
  try {
    await fetch('editor.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=delete_design&name=' + encodeURIComponent(name),
    });
  } catch(_) {}
  _log('Deleted "' + name + '"', 'err');
}

function renderDesignList() {
  const list = document.getElementById('design-list');
  document.getElementById('design-count').textContent = designLib.length;
  if (!list) return;
  list.innerHTML = '';

  if (!designLib.length) {
    list.innerHTML = '<div style="padding:10px;color:var(--dim);font-size:10px">No designs. Paste from game or load from server.</div>';
    document.getElementById('design-spawn-out').textContent = '—';
    return;
  }

  designLib.forEach((d, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr auto auto auto;align-items:center;' +
      'gap:6px;padding:6px 10px;border-bottom:1px solid var(--border);font-size:11px';
    row.innerHTML =
      '<span style="color:var(--green2)">' + d.name +
        '<span style="color:var(--dim);font-size:9px;margin-left:6px">' + d.parts.length + ' parts</span></span>' +
      '<button onclick="selectDesign(' + i + ')" style="background:none;border:1px solid var(--green0);' +
        'color:var(--green1);font-family:var(--font);font-size:9px;padding:2px 6px;cursor:pointer;border-radius:2px">Select</button>' +
      '<button onclick="copyDesignJSON(' + i + ')" style="background:none;border:1px solid #224488;' +
        'color:var(--blue);font-family:var(--font);font-size:9px;padding:2px 6px;cursor:pointer;border-radius:2px">Copy</button>' +
      '<button onclick="deleteDesign(\'' + d.name.replace(/'/g,"\\'") + '\')" style="background:none;border:none;' +
        'color:#ee5544;font-family:var(--font);font-size:11px;cursor:pointer;padding:0 4px">✕</button>';
    list.appendChild(row);
  });

  // Generate spawn JS for all designs
  const spawnJS = designLib.map(d =>
    '// ' + d.name + ' (' + d.parts.length + ' parts)\n' +
    'spawnFromDesign(' + JSON.stringify(d) + ', playerPos);'
  ).join('\n\n');
  document.getElementById('design-spawn-out').textContent = spawnJS;
}

function selectDesign(i) {
  const d = designLib[i];
  if (!d) return;
  const json = JSON.stringify(d, null, 2);
  document.getElementById('design-spawn-out').textContent =
    '// Spawn "' + d.name + '" at player position:\n' +
    'import { spawnFromDesign } from \'./shelters.js\';\n' +
    'spawnFromDesign(' + json + ', getPlayerPos());';
  _log('Selected "' + d.name + '"', 'info');
}

function copyDesignJSON(i) {
  const d = designLib[i];
  if (!d) return;
  navigator.clipboard?.writeText(JSON.stringify(d, null, 2));
  _log('Copied "' + d.name + '" JSON', 'info');
}

// ---- init load ----
window.addEventListener('load', loadDesigns);

// ============================================================
//  Tab switch (update to include designs)
// ============================================================
function switchTab(name) {
  const names = ['shelters','output','json','designs'];
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', names[i] === name);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === 'tab-' + name);
  });
}

// ---- Clock ----
setInterval(() => {
  document.getElementById('hdr-time').textContent = new Date().toLocaleTimeString();
}, 1000);

// ---- Init ----
renderList();
generateAll();
</script>
</body>
</html>