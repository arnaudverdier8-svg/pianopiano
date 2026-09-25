import type { NoteMeasurement } from './detector/calibration';
import type { DetectorCapabilities, DetectorFrame, DetectorSettings } from './detector/types';

/** Messages main thread → analysis worker. */
export type ToWorker =
  | { type: 'init'; port: MessagePort; inputRate: number }
  /** New session/seek generation: results produced after this carry `generation`; `reset` clears detector history. */
  | { type: 'generation'; generation: number; reset: boolean }
  | { type: 'configure'; settings: Partial<DetectorSettings>; noiseProfile?: number[] | null }
  | { type: 'capture-noise' }
  | { type: 'measure-note'; pitch: number; seconds: number; requestId: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'stop' };

export interface FrameMessage {
  type: 'frames';
  generation: number;
  frames: DetectorFrame[];
  /** Worker processing time for these frames, ms. */
  processMs: number;
  /** Audio seconds that waited in the worker queue before analysis (backpressure indicator). */
  queueSeconds: number;
  /** Chunks dropped to catch up since the last message. */
  dropped: number;
}

/** Messages analysis worker → main thread. */
export type FromWorker =
  | { type: 'ready'; capabilities: DetectorCapabilities; detectorRate: number; inputRate: number }
  | FrameMessage
  | { type: 'noise-profile'; profile: number[] | null; rmsDb: number }
  | { type: 'measurement'; requestId: number; result: NoteMeasurement | null; peak: number }
  | { type: 'error'; message: string };
