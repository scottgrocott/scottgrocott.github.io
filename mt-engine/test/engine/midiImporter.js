// engine/midiImporter.js

import { Midi } from "https://esm.sh/@tonejs/midi@2.0.27";

export async function importMidiFile(file) {

  const arrayBuffer = await file.arrayBuffer();
  const midi = new Midi(arrayBuffer);

  const json = {
    meta: {
      bpm: midi.header.tempos[0]?.bpm || 120
    },
    tracks: []
  };

  midi.tracks.forEach((track, index) => {

    json.tracks.push({
      id: "track_" + index,
      instrument: autoAssign(track.name),
      pattern: track.notes.map(n => ({
        time: n.time,
        duration: n.duration,
        note: n.name,
        velocity: n.velocity
      }))
    });

  });

  return json;
}

function autoAssign(name = "") {

  const n = name.toLowerCase();

  if (n.includes("bass")) return "mono_sub_bass";
  if (n.includes("drum")) return "808_kit";
  if (n.includes("pad")) return "slow_attack_pad";

  return "poly_default";
}