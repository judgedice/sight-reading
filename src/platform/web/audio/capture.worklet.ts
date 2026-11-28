/**
 * AudioWorklet entry (01 §7.2): registers the capture processor. Loaded with `audioWorklet.addModule`, so it
 * runs in AudioWorkletGlobalScope, whose globals (`AudioWorkletProcessor`, `registerProcessor`, `sampleRate`,
 * `currentFrame`) are not in the DOM lib and are read through `globalThis` here.
 *
 * The node must be built with one input and one output and connected to the destination through a zero gain so
 * that WebKit pulls it (05 Q3). The output stays silent.
 */
import { CaptureCore, type CorePort } from '../../shared/audio/capture-processor.ts';
import { CAPTURE_PROCESSOR_NAME } from '../../shared/audio/protocol.ts';

interface WorkletScope {
  AudioWorkletProcessor: new () => { readonly port: MessagePort };
  registerProcessor(name: string, ctor: unknown): void;
  sampleRate: number;
  currentFrame: number;
}

const scope = globalThis as unknown as WorkletScope;

class CaptureProcessor extends scope.AudioWorkletProcessor {
  private readonly core: CaptureCore;

  constructor() {
    super();
    this.core = new CaptureCore(scope.sampleRate, this.port as unknown as CorePort, () => scope.currentFrame);
  }

  process(inputs: Float32Array[][]): boolean {
    return this.core.process(inputs[0]);
  }
}

scope.registerProcessor(CAPTURE_PROCESSOR_NAME, CaptureProcessor);
