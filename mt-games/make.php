<?php
$filename = 'level-0.json';

// ==========================================
// BACKEND API LOGIC
// ==========================================
if (isset($_GET['api'])) {
    header('Content-Type: application/json');

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = file_get_contents('php://input');
        if (json_decode($input) !== null) {
            $success = file_put_contents($filename, $input);
            if ($success !== false) {
                echo json_encode(['status' => 'success', 'message' => 'File saved successfully!']);
            } else {
                http_response_code(500);
                echo json_encode(['status' => 'error', 'message' => 'Permission denied. Cannot write to file.']);
            }
        } else {
            http_response_code(400);
            echo json_encode(['status' => 'error', 'message' => 'Invalid JSON structure provided.']);
        }
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if (file_exists($filename)) {
            echo file_get_contents($filename);
        } else {
            echo json_encode(new stdClass());
        }
        exit;
    }
}
?>

<!-- ========================================== -->
<!-- FRONTEND SPA LOGIC                         -->
<!-- ========================================== -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Level Editor (level-0.json)</title>
    
    <link href="https://cdnjs.cloudflare.com/ajax/libs/jsoneditor/9.10.0/jsoneditor.min.css" rel="stylesheet" type="text/css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jsoneditor/9.10.0/jsoneditor.min.js"></script>

    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f4f5f7;
            display: flex;
            flex-direction: column;
            height: 100vh;
            box-sizing: border-box;
        }
        header {
            background: #fff;
            padding: 15px 25px;
            border-radius: 8px 8px 0 0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .instructions {
            background: #e9ecef;
            padding: 10px 25px;
            font-size: 14px;
            color: #495057;
            border-radius: 0 0 8px 8px;
            margin-bottom: 15px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            display: flex;
            gap: 20px;
        }
        .instructions kbd {
            background: #fff; border: 1px solid #ccc; padding: 2px 6px; border-radius: 4px; font-size: 12px;
        }
        h1 { margin: 0; font-size: 20px; color: #333; }
        .controls { display: flex; align-items: center; gap: 15px; }
        button {
            padding: 10px 20px;
            background-color: #007bff;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            transition: background 0.2s;
        }
        button:hover { background-color: #0056b3; }
        #jsoneditor {
            flex-grow: 1;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border-radius: 8px;
            overflow: hidden;
            background: #fff;
        }
        .status { font-size: 14px; font-weight: 600; }
        .success { color: #28a745; }
        .error { color: #dc3545; }
        
        /* Highlight the action menu button on hover so it's easy to find */
        .jsoneditor-contextmenu-button { background-color: #f0f0f0; border-radius: 4px; }
        .jsoneditor-contextmenu-button:hover { background-color: #dcdcdc; }
    </style>
</head>
<body>

    <header>
        <h1>🎮 Level Config Editor <code>(level-0.json)</code></h1>
        <div class="controls">
            <span id="statusMessage" class="status"></span>
            <button id="saveBtn">💾 Save Changes</button>
        </div>
    </header>
    
    <div class="instructions">
        <span><strong>To Duplicate:</strong> Click the <kbd>⋮</kbd> button on the left of any item and click <strong>Duplicate</strong>.</span>
        <span><strong>To Add New:</strong> Click the <kbd>⋮</kbd> button on an array (like <em>heightmaps</em> or <em>fortresses</em>), click <strong>Append</strong>, and select your custom template!</span>
    </div>

    <!-- Container for the visual editor -->
    <div id="jsoneditor"></div>

    <script>
        const container = document.getElementById("jsoneditor");
        const options = {
            mode: 'tree',
            modes:['tree', 'code', 'form', 'view'],
            name: 'levelConfig',
            search: true,
            indentation: 2,
            
            // ==============================================================
            // CUSTOM TEMPLATES FOR RAPID ARRAY ADDITIONS
            // ==============================================================
            templates:[
                {
                    text: '⭐ New Heightmap',
                    title: 'Insert a fully structured blank heightmap',
                    field: 'heightmap',
                    value: {
                        "_name": "New Region",
                        "url": "https://scottgrocott.github.io/mt-assets/heightmaps/drone-wars/v1/map-new.png",
                        "shelterCount": 5,
                        "environment": {
                            "types": ["env_wetland"],
                            "shaderLayers":[
                                { "minElevation": 0.0, "maxElevation": 0.5, "color": "#1e3a10", "blend": "smooth" },
                                { "minElevation": 0.5, "maxElevation": 1.0, "color": "#606850", "blend": "smooth" }
                            ]
                        },
                        "structures": {
                            "fortresses": [],
                            "villages": [],
                            "cities":[]
                        }
                    }
                },
                {
                    text: '🏰 New Fortress',
                    title: 'Insert a new fortress object',
                    field: 'fortress',
                    value: { "enabled": true, "name": "New Fortress", "position": { "x": 0, "y": 20.0, "z": 0 }, "rotation": 0 }
                },
                {
                    text: '🏕️ New Village',
                    title: 'Insert a new village object',
                    field: 'village',
                    value: { "enabled": true, "name": "New Village", "position": { "x": 0, "y": 20.0, "z": 0 }, "rotation": 0 }
                },
                {
                    text: '🏙️ New City',
                    title: 'Insert a new city object',
                    field: 'city',
                    value: { "enabled": true, "name": "New City", "position": { "x": 0, "y": 20.0, "z": 0 }, "rotation": 0 }
                }
            ],
            onError: function (err) {
                showStatus(err.toString(), true);
            }
        };
        const editor = new JSONEditor(container, options);

        fetch('?api=1')
            .then(response => response.json())
            .then(data => {
                editor.set(data);
                // Expand commonly edited paths by default
                editor.expand({ path:['terrain'] });
                editor.expand({ path: ['terrain', 'heightmaps'] });
            })
            .catch(err => {
                showStatus("Error loading level-0.json", true);
            });

        document.getElementById('saveBtn').addEventListener('click', () => {
            try {
                const updatedJson = editor.get(); 
                showStatus("Saving...", false);

                fetch('?api=1', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedJson, null, 2) 
                })
                .then(response => response.json())
                .then(data => {
                    if(data.status === 'success') {
                        showStatus("✅ " + data.message);
                    } else {
                        showStatus("❌ " + data.message, true);
                    }
                })
                .catch(err => {
                    showStatus("❌ Network error while saving.", true);
                });
            } catch (err) {
                showStatus("❌ Invalid JSON format!", true);
            }
        });

        let timeout;
        function showStatus(msg, isError = false) {
            const statusEl = document.getElementById('statusMessage');
            statusEl.textContent = msg;
            statusEl.className = 'status ' + (isError ? 'error' : 'success');
            clearTimeout(timeout);
            timeout = setTimeout(() => { statusEl.textContent = ''; }, 4000);
        }
    </script>
</body>
</html>