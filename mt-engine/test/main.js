import { AudioEngine } from "./engine/audioEngine.js";
import { loadDemoProject } from "./storage/persistence.js";
import { importMidiFile } from "./engine/midiImporter.js";

const engine = new AudioEngine();

document.getElementById("initAudio").onclick = async () => {
  await engine.init();

  const project = await loadDemoProject();
  engine.loadProject(project);

  console.log("Demo project loaded.");
};

document.getElementById("play").onclick = () => {
  engine.play();
};

document.getElementById("stop").onclick = () => {
  engine.stop();
};

document.getElementById("midiInput").onchange = async (e) => {
  const json = await importMidiFile(e.target.files[0]);

  document.getElementById("debug").textContent =
    JSON.stringify(json, null, 2);
};