// engine/synthFactory.js

import * as Tone from "https://esm.sh/tone@14.8.49";
import { buildEffectsChain } from "./effectsFactory.js";

export function createSynth(def) {

  let synth;

  switch (def.engine) {

    case "MonoSynth":
      synth = new Tone.MonoSynth(def.options);
      break;

    case "FMSynth":
      synth = new Tone.FMSynth(def.options);
      break;

    case "AMSynth":
      synth = new Tone.AMSynth(def.options);
      break;

    case "PolySynth":
    default:
      synth = new Tone.PolySynth(Tone.Synth, def.options);
  }

  // Build effects but do NOT replace synth
  const finalNode = buildEffectsChain(synth, def.effects);

  finalNode.toDestination();

  // 🔥 Return synth, not effect node
  return synth;
}