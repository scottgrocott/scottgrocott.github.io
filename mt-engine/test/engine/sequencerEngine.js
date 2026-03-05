import * as Tone from "https://esm.sh/tone@14.8.49";

export class SequencerEngine {

  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.parts = [];
  }

  load(sequenceJson) {

    this.parts.forEach(p => p.dispose());
    this.parts = [];

    Tone.Transport.stop();
    Tone.Transport.cancel();

    Tone.Transport.bpm.value = sequenceJson.meta.bpm || 120;

    sequenceJson.tracks.forEach(track => {

      const instrument = this.audioEngine.instruments[track.id];

      const part = new Tone.Part((time, note) => {
        instrument.triggerAttackRelease(
          note.note,
          note.duration,
          time,
          note.velocity
        );
      }, track.pattern).start(0);

      this.parts.push(part);
    });
  }

  start() {
    Tone.Transport.start();
  }

  stop() {
    Tone.Transport.stop();
  }
}