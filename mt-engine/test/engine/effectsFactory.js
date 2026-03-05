// engine/effectsFactory.js

import * as Tone from "https://esm.sh/tone@14.8.49";

export function buildEffectsChain(source, effects = []) {

  let current = source;

  effects.forEach(effectDef => {

    let effect;

    switch (effectDef.type) {

      case "Reverb":
        effect = new Tone.Reverb(effectDef.options);
        break;

      case "Chorus":
        effect = new Tone.Chorus(effectDef.options);
        break;

      case "Compressor":
        effect = new Tone.Compressor(effectDef.options);
        break;

      default:
        console.warn("Unknown effect:", effectDef.type);
        return;
    }

    current.connect(effect);
    current = effect;
  });

  return current;
}