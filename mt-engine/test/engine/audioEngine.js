import * as Tone from "https://esm.sh/tone@14.8.49";
import { createSynth } from "./synthFactory.js";
import { createSampler } from "./samplerFactory.js";
import { SequencerEngine } from "./sequencerEngine.js";

export class AudioEngine {

  constructor() {
    this.project = null;
    this.instruments = {};
    this.sequencer = new SequencerEngine(this);
  }

  async init() {
    await Tone.start();
    console.log("Audio Ready");
  }

  loadProject(projectJson) {

    this.project = projectJson;
    this.instruments = {};

    projectJson.tracks.forEach(track => {
      const inst = this.createInstrument(track.instrument);
      this.instruments[track.id] = inst;
    });

    this.sequencer.load(projectJson.sequence);
  }

  createInstrument(definition) {

    if (definition.type === "synth") {
      return createSynth(definition);
    }

    if (definition.type === "sampler") {
      return createSampler(definition);
    }

    console.warn("Unknown instrument type:", definition.type);
  }

  play() {
    this.sequencer.start();
  }

  stop() {
    this.sequencer.stop();
  }
}