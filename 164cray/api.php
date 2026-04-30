<?php
/**
 * api.php — downloads a batch of video thumbnails to a target directory.
 *
 * Request (POST, JSON body):
 *   {
 *     "target_dir": "/absolute/or/relative/path",
 *     "items": [
 *       { "oid": "64d28b85773e31b05607b87f", "thumb": "https://..." },
 *       ...
 *     ]
 *   }
 *
 * Response (JSON):
 *   {
 *     "ok": true,
 *     "target_dir": "/resolved/path",
 *     "results": [
 *       { "oid": "...", "status": "downloaded" | "skipped" | "error",
 *         "bytes": 12345, "error": "..." },
 *       ...
 *     ]
 *   }
 */

header('Content-Type: application/json');

// ---- Parse + validate input ----
$raw = file_get_contents('php://input');
$body = json_decode($raw, true);

if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid JSON body']);
    exit;
}

$targetDir = isset($body['target_dir']) ? trim($body['target_dir']) : '';
$items = isset($body['items']) && is_array($body['items']) ? $body['items'] : [];

if ($targetDir === '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'target_dir is required']);
    exit;
}

// ---- Prepare target directory ----
// Expand ~ to the user's home dir for convenience on local dev
if (strpos($targetDir, '~') === 0) {
    $home = getenv('HOME') ?: getenv('USERPROFILE') ?: '';
    if ($home !== '') {
        $targetDir = $home . substr($targetDir, 1);
    }
}

if (!is_dir($targetDir)) {
    if (!@mkdir($targetDir, 0775, true) && !is_dir($targetDir)) {
        http_response_code(400);
        echo json_encode([
            'ok' => false,
            'error' => "Cannot create target directory: $targetDir",
        ]);
        exit;
    }
}

$resolvedDir = realpath($targetDir);
if ($resolvedDir === false) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => "Cannot resolve target directory: $targetDir"]);
    exit;
}

if (!is_writable($resolvedDir)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => "Target directory is not writable: $resolvedDir"]);
    exit;
}

// ---- Stream context for downloads ----
// Use a real browser UA + Referer; some image CDNs (Rumble's included)
// 403 the default PHP user-agent or hotlink-block requests with no referer.
$browserUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
           . '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';
$commonHeaders = "Accept: image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5\r\n"
               . "Accept-Language: en-US,en;q=0.9\r\n"
               . "Referer: https://rumble.com/\r\n";

$ctx = stream_context_create([
    'http' => [
        'timeout' => 20,
        'follow_location' => 1,
        'user_agent' => $browserUA,
        'header' => $commonHeaders,
    ],
    'https' => [
        'timeout' => 20,
        'follow_location' => 1,
        'user_agent' => $browserUA,
        'header' => $commonHeaders,
    ],
]);

// ---- Process items ----
$results = [];

foreach ($items as $item) {
    $oid = isset($item['oid']) ? (string)$item['oid'] : '';
    $thumb = isset($item['thumb']) ? (string)$item['thumb'] : '';

    // Sanity check the oid so it can't traverse paths
    if ($oid === '' || !preg_match('/^[a-zA-Z0-9_-]+$/', $oid)) {
        $results[] = ['oid' => $oid, 'status' => 'error', 'error' => 'Invalid oid'];
        continue;
    }
    if ($thumb === '') {
        $results[] = ['oid' => $oid, 'status' => 'error', 'error' => 'No thumb URL'];
        continue;
    }

    // Always save as .jpg per the spec — these are all .jpg in the source data
    $destPath = $resolvedDir . DIRECTORY_SEPARATOR . $oid . '.jpg';

    // Skip if the file already exists and is non-empty
    if (is_file($destPath) && filesize($destPath) > 0) {
        $results[] = [
            'oid' => $oid,
            'status' => 'skipped',
            'bytes' => filesize($destPath),
        ];
        continue;
    }

    // Download
    $data = @file_get_contents($thumb, false, $ctx);
    if ($data === false || $data === '') {
        $err = error_get_last();
        $results[] = [
            'oid' => $oid,
            'status' => 'error',
            'error' => 'Download failed: ' . ($err['message'] ?? 'unknown'),
        ];
        continue;
    }

    // Write atomically: tmp file then rename
    $tmp = $destPath . '.part';
    $bytes = @file_put_contents($tmp, $data);
    if ($bytes === false) {
        $results[] = ['oid' => $oid, 'status' => 'error', 'error' => 'Write failed'];
        @unlink($tmp);
        continue;
    }
    if (!@rename($tmp, $destPath)) {
        @unlink($tmp);
        $results[] = ['oid' => $oid, 'status' => 'error', 'error' => 'Rename failed'];
        continue;
    }

    $results[] = ['oid' => $oid, 'status' => 'downloaded', 'bytes' => $bytes];
}

echo json_encode([
    'ok' => true,
    'target_dir' => $resolvedDir,
    'results' => $results,
]);