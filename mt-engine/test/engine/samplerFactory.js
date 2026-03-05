import * as Tone from "https://esm.sh/tone@14.8.49";

export function createSampler(def) {

  const sampler = new Tone.Sampler({
    urls: def.urls,
    baseUrl: def.baseUrl,
    release: def.release || 1
  });

  sampler.toDestination();

  return sampler;
}