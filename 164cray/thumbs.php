<?php
/**
 * index.php — SPA for batch-downloading video thumbnails.
 * Loads videos.json (NDJSON) once and ships it to the browser.
 */

$jsonPath = __DIR__ . '/videos.json';
$jsonAvailable = is_file($jsonPath);
$videoCount = 0;
$videosJsonForJs = '[]';

if ($jsonAvailable) {
    // Parse NDJSON server-side so the client gets a clean JS array
    $records = [];
    $fh = fopen($jsonPath, 'r');
    if ($fh) {
        while (($line = fgets($fh)) !== false) {
            $line = trim($line);
            if ($line === '') continue;
            $rec = json_decode($line, true);
            if (!is_array($rec)) continue;

            $oid = $rec['_id']['$oid'] ?? null;
            $thumb = $rec['thumb'] ?? null;
            $title = $rec['title'] ?? '(untitled)';

            if ($oid && $thumb) {
                $records[] = [
                    'oid'   => $oid,
                    'thumb' => $thumb,
                    'title' => $title,
                ];
            }
        }
        fclose($fh);
    }
    $videoCount = count($records);
    $videosJsonForJs = json_encode($records, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Thumbnail Downloader</title>
<style>
  :root {
    --bg: #0f1115;
    --panel: #181b22;
    --panel-2: #20242d;
    --border: #2a2f3a;
    --text: #e6e8ec;
    --muted: #8a93a3;
    --accent: #4f8cff;
    --ok: #5dd17b;
    --skip: #d4b15b;
    --err: #ff6b6b;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  header {
    padding: 18px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  header h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  header .sub {
    color: var(--muted);
    font-size: 13px;
    margin-top: 4px;
  }

  main {
    flex: 1;
    padding: 24px;
    max-width: 880px;
    width: 100%;
    margin: 0 auto;
  }

  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 16px;
  }
  .card h2 {
    margin: 0 0 12px;
    font-size: 14px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--muted);
  }

  label {
    display: block;
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 6px;
  }
  input[type="text"], input[type="number"] {
    width: 100%;
    background: var(--panel-2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 10px 12px;
    border-radius: 6px;
    font-size: 14px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    outline: none;
  }
  input:focus { border-color: var(--accent); }
  .row { display: flex; gap: 12px; align-items: end; }
  .row > div { flex: 1; }
  .row > div.narrow { flex: 0 0 130px; }

  button.primary {
    background: var(--accent);
    color: #fff;
    border: none;
    padding: 10px 20px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    margin-top: 16px;
  }
  button.primary:hover:not(:disabled) { background: #3a78ee; }
  button.primary:disabled { opacity: 0.5; cursor: not-allowed; }

  button.secondary {
    background: transparent;
    color: var(--muted);
    border: 1px solid var(--border);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    margin-left: 8px;
  }
  button.secondary:hover { color: var(--text); border-color: var(--text); }

  .progress-bar {
    height: 8px;
    background: var(--panel-2);
    border-radius: 4px;
    overflow: hidden;
    margin-top: 12px;
  }
  .progress-bar .fill {
    height: 100%;
    background: var(--accent);
    width: 0%;
    transition: width 0.2s ease;
  }

  .stats {
    display: flex;
    gap: 16px;
    margin-top: 12px;
    font-size: 13px;
    flex-wrap: wrap;
  }
  .stat {
    color: var(--muted);
  }
  .stat strong { color: var(--text); }
  .stat.ok strong { color: var(--ok); }
  .stat.skip strong { color: var(--skip); }
  .stat.err strong { color: var(--err); }

  .log {
    background: #0a0c10;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    max-height: 380px;
    overflow-y: auto;
    margin-top: 12px;
  }
  .log .line { display: flex; gap: 8px; }
  .log .tag {
    flex: 0 0 90px;
    font-weight: 600;
  }
  .log .tag.ok { color: var(--ok); }
  .log .tag.skip { color: var(--skip); }
  .log .tag.err { color: var(--err); }
  .log .oid { color: var(--muted); flex: 0 0 230px; }
  .log .msg { color: var(--text); flex: 1; word-break: break-all; }

  .warn {
    background: #3a2a18;
    border: 1px solid #6b4a1f;
    color: #f4d493;
    padding: 12px 14px;
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 16px;
  }
</style>
</head>
<body>
<header>
  <h1>Thumbnail Downloader</h1>
  <div class="sub">Reads <code>videos.json</code>, downloads each thumbnail, saves as <code>{oid}.jpg</code></div>
</header>

<main>
  <?php if (!$jsonAvailable): ?>
    <div class="warn">
      <strong>videos.json not found.</strong> Place it in the same folder as <code>index.php</code> and reload.
    </div>
  <?php endif; ?>

  <div class="card">
    <h2>Settings</h2>
    <div class="row">
      <div>
        <label for="target">Target directory (absolute path or relative to this folder)</label>
        <input type="text" id="target" placeholder="e.g. ./thumbs  or  /Users/me/Desktop/thumbs" value="./thumbs">
      </div>
      <div class="narrow">
        <label for="batch">Batch size</label>
        <input type="number" id="batch" min="1" max="100" value="25">
      </div>
    </div>
    <button class="primary" id="run" <?= $jsonAvailable ? '' : 'disabled' ?>>
      Download All<?= $jsonAvailable ? " ($videoCount)" : '' ?>
    </button>
    <button class="secondary" id="cancel" disabled>Cancel</button>
  </div>

  <div class="card" id="progress-card" style="display:none">
    <h2>Progress</h2>
    <div class="progress-bar"><div class="fill" id="fill"></div></div>
    <div class="stats">
      <span class="stat"><strong id="s-done">0</strong> / <span id="s-total">0</span> processed</span>
      <span class="stat ok"><strong id="s-ok">0</strong> downloaded</span>
      <span class="stat skip"><strong id="s-skip">0</strong> skipped</span>
      <span class="stat err"><strong id="s-err">0</strong> errors</span>
    </div>
    <div class="log" id="log"></div>
  </div>
</main>

<script>
  const VIDEOS = <?= $videosJsonForJs ?>;

  const $target = document.getElementById('target');
  const $batch = document.getElementById('batch');
  const $run = document.getElementById('run');
  const $cancel = document.getElementById('cancel');
  const $progressCard = document.getElementById('progress-card');
  const $fill = document.getElementById('fill');
  const $sDone = document.getElementById('s-done');
  const $sTotal = document.getElementById('s-total');
  const $sOk = document.getElementById('s-ok');
  const $sSkip = document.getElementById('s-skip');
  const $sErr = document.getElementById('s-err');
  const $log = document.getElementById('log');

  let cancelled = false;

  function logLine(status, oid, msg) {
    const line = document.createElement('div');
    line.className = 'line';
    line.innerHTML =
      `<span class="tag ${status}">${status.toUpperCase()}</span>` +
      `<span class="oid">${oid}</span>` +
      `<span class="msg"></span>`;
    line.querySelector('.msg').textContent = msg;
    $log.appendChild(line);
    $log.scrollTop = $log.scrollHeight;
  }

  async function processBatch(targetDir, items) {
    const res = await fetch('api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_dir: targetDir, items }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json();
  }

  $run.addEventListener('click', async () => {
    const targetDir = $target.value.trim();
    if (!targetDir) {
      alert('Please enter a target directory.');
      return;
    }
    const batchSize = Math.max(1, Math.min(100, parseInt($batch.value, 10) || 25));

    cancelled = false;
    $run.disabled = true;
    $cancel.disabled = false;
    $progressCard.style.display = 'block';
    $log.innerHTML = '';

    const total = VIDEOS.length;
    $sTotal.textContent = total;
    let done = 0, ok = 0, skip = 0, err = 0;
    $sDone.textContent = '0';
    $sOk.textContent = '0';
    $sSkip.textContent = '0';
    $sErr.textContent = '0';
    $fill.style.width = '0%';

    try {
      for (let i = 0; i < total; i += batchSize) {
        if (cancelled) {
          logLine('err', '—', 'Cancelled by user.');
          break;
        }

        const slice = VIDEOS.slice(i, i + batchSize);
        let result;
        try {
          result = await processBatch(targetDir, slice);
        } catch (e) {
          // Whole batch failed — log each as error
          slice.forEach(v => {
            err++;
            logLine('err', v.oid, e.message);
          });
          done += slice.length;
          $sDone.textContent = done;
          $sErr.textContent = err;
          $fill.style.width = ((done / total) * 100).toFixed(1) + '%';
          continue;
        }

        if (!result.ok) {
          slice.forEach(v => {
            err++;
            logLine('err', v.oid, result.error || 'Unknown server error');
          });
          done += slice.length;
        } else {
          result.results.forEach(r => {
            done++;
            if (r.status === 'downloaded') {
              ok++;
              logLine('ok', r.oid, `${r.bytes} bytes`);
            } else if (r.status === 'skipped') {
              skip++;
              logLine('skip', r.oid, `already exists (${r.bytes} bytes)`);
            } else {
              err++;
              logLine('err', r.oid, r.error || 'Unknown error');
            }
          });
        }

        $sDone.textContent = done;
        $sOk.textContent = ok;
        $sSkip.textContent = skip;
        $sErr.textContent = err;
        $fill.style.width = ((done / total) * 100).toFixed(1) + '%';
      }

      if (!cancelled) {
        const finalLine = document.createElement('div');
        finalLine.className = 'line';
        finalLine.style.marginTop = '8px';
        finalLine.style.paddingTop = '8px';
        finalLine.style.borderTop = '1px solid #2a2f3a';
        finalLine.innerHTML = `<span class="tag ok">DONE</span><span class="msg">${ok} downloaded, ${skip} skipped, ${err} errors</span>`;
        $log.appendChild(finalLine);
        $log.scrollTop = $log.scrollHeight;
      }
    } finally {
      $run.disabled = false;
      $cancel.disabled = true;
    }
  });

  $cancel.addEventListener('click', () => {
    cancelled = true;
    $cancel.disabled = true;
  });
</script>
</body>
</html>