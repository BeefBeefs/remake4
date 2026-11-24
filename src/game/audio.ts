import { assetUrl } from '../data/loaders';

/** Sound effects (PCM WAV) through WebAudio, music (CD tracks as Ogg) through an <audio> element. */
export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  private music = new Audio();
  private musicOn = false;
  private current = '';

  constructor() {
    this.music.loop = true;
    this.music.volume = 0.5;
  }

  /** must be called from a user gesture */
  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private load(name: string): Promise<AudioBuffer | null> {
    const key = name.toLowerCase();
    let p = this.cache.get(key);
    if (!p) {
      p = fetch(assetUrl(`sfx/${key}`))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(key))))
        .then((b) => this.ctx!.decodeAudioData(b))
        .catch(() => null);
      this.cache.set(key, p);
    }
    return p;
  }

  async play(name: string, volume = 0.8): Promise<void> {
    if (!this.ctx) return;
    const buf = await this.load(name);
    if (!buf || !this.ctx) return;
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.buffer = buf;
    src.connect(gain).connect(this.ctx.destination);
    src.start();
  }

  setMusic(track: number): void {
    const url = assetUrl(`music/track${String(track).padStart(2, '0')}.ogg`);
    if (url === this.current) return;
    this.current = url;
    this.music.src = url;
    if (this.musicOn) void this.music.play().catch(() => {});
  }

  isMusicOn(): boolean {
    return this.musicOn;
  }

  toggleMusic(): boolean {
    this.musicOn = !this.musicOn;
    if (this.musicOn) void this.music.play().catch(() => {});
    else this.music.pause();
    return this.musicOn;
  }
}
