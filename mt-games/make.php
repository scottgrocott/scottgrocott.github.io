<?php
// Define the target JSON file
$filename = 'level-0.json';

// ==========================================
// BACKEND API LOGIC
// ==========================================
if (isset($_GET['api'])) {
    header('Content-Type: application/json');

    // Handle Saving (POST)
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = file_get_contents('php://input');
        
        // Validate that the input is actually valid JSON
        if (json_decode($input) !== null) {
            // Write to file (Make sure PHP has write permissions to this file/folder)
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

    // Handle Loading (GET)
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if (file_exists($filename)) {
            echo file_get_contents($filename);
        } else {
            // Return an empty object if the file doesn't exist yet
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
    
    <!-- Include JSONEditor CSS and JS from CDN -->
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
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            background: #fff;
            padding: 15px 25px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
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
        
        /* Custom tweaks for the editor */
        .jsoneditor-menu { background-color: #343a40; border-bottom: none; }
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

    <!-- Container for the visual editor -->
    <div id="jsoneditor"></div>

    <script>
        // Initialize the JSON Editor
        const container = document.getElementById("jsoneditor");
        const options = {
            mode: 'tree', // Default mode
            modes: ['tree', 'code', 'form', 'view'], // Allows switching to raw text code view
            name: 'levelConfig',
            search: true,
            indentation: 2,
            onError: function (err) {
                showStatus(err.toString(), true);
            }
        };
        const editor = new JSONEditor(container, options);

        // Fetch the file contents when the page loads
        fetch('?api=1')
            .then(response => response.json())
            .then(data => {
                editor.set(data);
                // Expand the first few levels automatically
                editor.expand({ path: ['meta'] });
                editor.expand({ path: ['terrain'] });
            })
            .catch(err => {
                console.error("Failed to load JSON", err);
                showStatus("Error loading level-0.json. Does it exist?", true);
            });

        // Save data back to the server
        document.getElementById('saveBtn').addEventListener('click', () => {
            try {
                // Get the updated JSON from the editor
                const updatedJson = editor.get(); 
                
                // Show saving state
                showStatus("Saving...", false);

                fetch('?api=1', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // Stringify with formatting to keep the file pretty
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
                // Catches syntax errors if the user is in "code" mode and left a trailing comma
                showStatus("❌ Invalid JSON format! Fix errors before saving.", true);
            }
        });

        // Utility to show temporary status messages
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