These files make up "Melody Canvas" in its current state.
This is a single-page web application that combines Three.js WebGPU, the Web MIDI API, and Tone.js into a full-screen interactive music visualizer with hand-tracking cursor support.

Basic goal of Melody Canvas: To allow a graphic artist using spatial computing to draw on a flat screen monitor or projector onto real canvas, and to create an environment where the graphic artist can collaborate with MIDI musicians in realtime — creating a "performance" that produces a graphic to print and sell on the spot when the performance ends.

═══════════════════════════════════════════════════════════
CURRENT STATE — end of session 2
═══════════════════════════════════════════════════════════

ARCHITECTURE:
  index.html   — single page shell, panel header fixed, all sections scroll inside #panel-scroll
  main.js      — boot sequence, animation loop (tickAudio + tickHand each frame)
  scene.js     — Three.js WebGPU renderer, camera, resize observer
  layers.js    — 10 MIDI channel layers (ch 0-9), each a TSL shader plane with 8 geometry algorithms
                 (Chladni, Lissajous, Cymatics, Wave Interference, Harmonograph, Rose, Fourier, Orbits)
                 4 audio-reactive uniforms per layer: ampU, attackU, brightnessU, onsetU
  synth.js     — 16 per-channel Tone.js voices (Lead, Strings, Bass, Chords, Arp/Pluck, Pad, Brass,
                 FX/PWM, Perc, Drums, + 6 Expansion channels)
  audio.js     — per-channel Tone.Meter + Tone.Analyser + JS-side ADSR envelope tracker,
                 feeds TSL uniforms every frame via setAudioUniforms()
  midi.js      — Web MIDI API, note-on/off routing to synth + audio + analyzer + display
  analyze.js   — rolling 8s MIDI feature extractor (BPM, key/mode via Krumhansl-Schmuckler,
                 chord complexity, velocity range, blue notes, syncopation, pitch class vector)
  classifier.js — maps extracted features to music style/genre labels
  display.js   — active note state, footer summary
  panel.js     — full control panel: MIDI select, audio enable, hand tracking section,
                 style detection display, collapsible channel layer rows with per-channel
                 synth GUI (volume, oscillator, envelope, effects), activity log
  popup.js     — pops Three.js canvas into a new borderless window without recreating GPU context
  theory.js    — MIDI note names, chord detection
  hand.js      — MediaPipe Hands + webcam hand cursor system (see below)
  style.css    — complete stylesheet, autoscrolling panel, readable grey scale

HAND TRACKING (hand.js):
  - Lazy-loaded on first click of "Enable Hand Tracking" button — no page-load cost
  - getUserMedia opens webcam (640x480, front-facing)
  - MediaPipe Hands (lite model) detects index finger tip each frame (landmark 8)
  - Lightweight Sobel edge detector runs every 8 frames to find the largest rectangular
    object in frame (the physical monitor/projector) via axis-aligned bounding box of strong edges
  - Finger tip coords are mapped into the detected rectangle's normalised space
  - A cursor <div> overlay appears in #canvas-container ONLY when the finger is inside the rect
  - Cursor color matches the currently selected hand layer
  - Layer is selected via a dropdown in the Hand Cursor panel section (CH 1-10, color-accented left border)
  - Brush sound: bandpass-filtered white noise fades in while cursor moves, fades to silence when still
    Each layer maps to a distinct filter frequency (CH1 ≈ 350Hz → CH10 ≈ 7000Hz)
  - Camera preview canvas (always visible, 16:9) shows mirrored video feed with:
      orange rectangle outline of the detected screen
      white hand skeleton overlay
      colored fingertip dot (matches active layer color)
  - tickHand(dt) called every animation frame alongside tickAudio(dt)

CONTROL PANEL:
  - Fixed header (title + pop-out button), everything else scrolls
  - Sections in order: MIDI Input, Audio, Hand Cursor, Style Detection, Channel Layers, Activity Log
  - All text colors are readable (dark greys lifted throughout)
  - Channel layer rows are collapsible — click to expand per-channel synth controls
  - Geometry algorithm selector per channel (dropdown, always available before audio is enabled)
  - Synth params (volume, waveform, ADSR, effects) appear after audio is enabled

CANVAS POP-OUT:
  - "Pop Out Canvas" moves the Three.js canvas DOM element into a new borderless window
  - No GPU context is recreated — renderer keeps drawing to the same canvas
  - Popup resize events forwarded back to parent so geometry stays correct
  - Reclaim button brings it back

STYLE DETECTION:
  - Real-time MIDI feature analysis every 2.5s over an 8s rolling window
  - Detects key/mode (Krumhansl-Schmuckler), BPM, chord complexity, blue notes, syncopation
  - Classifier maps features to genre label with top-3 confidence bars
  - Not fully developed — classification logic in classifier.js is a work in progress

WHAT IS WORKING:
  - Full MIDI receive, synthesis, and visual rendering pipeline
  - Audio-reactive TSL shaders responding to amplitude, envelope, spectral brightness, and attack transients
  - Hand cursor tracking with screen rectangle detection and layer-colored cursor
  - Brush sound tied to cursor movement
  - Camera preview with hand skeleton and rect overlay
  - Per-channel synth GUI with all effect parameters
  - Panel autoscroll
  - Canvas pop-out to secondary monitor

═══════════════════════════════════════════════════════════
NEXT SESSION — likely directions
═══════════════════════════════════════════════════════════

The hand cursor framework is now in place. The natural next step is "audio brushes":
when the cursor moves over the canvas, it should actually draw — leaving a mark that
corresponds to the active layer's shader/color and responds to the brush sound parameters.
This means the cursor needs to write into a texture or geometry that persists on the canvas.

Other directions under consideration:
  - Improve rectangle detection robustness (ArUco markers, or MediaPipe ObjectDetection)
  - Export / print: capture the final canvas state as a high-res image at end of performance
  - Expand style classifier with more genre rules and subgenre resolution
  - MIDI-controlled layer selection for hand cursor (CC message)
  - Merge with the musician-collaboration branch

NOTE ON RECTANGLE DETECTION:
The Sobel AABB approach works best when the monitor has a clean bright edge against a
darker background. A strip of bright tape or LED strip around the monitor frame gives the
edge detector something unambiguous to lock onto. ArUco markers are the robust long-term fix.