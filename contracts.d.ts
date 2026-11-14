export type ExerciseID = 'side-view-squat' | 'overhead-reach' | 't-pose-open';
export type AttemptStatus = 'completed' | 'skipped' | 'aborted' | 'insufficient-data' | 'unavailable';
export interface ExerciseConfig { name: string; view: 'side' | 'front'; targetReps: number; maxDemoMs: number; setup: string; action: string; signal: string; standDeg?: number; bottomDeg?: number; }
export interface RepObservation { rangeDeg: number; durationSec: number; }
export interface MovementAttempt {
  exercise: ExerciseID; view: 'side' | 'front'; calibration: 'stable-pose-v2'; protocolVersion: 2;
  status: AttemptStatus; source: 'camera' | null; reps: number | null; targetReps: number; repetitions: RepObservation[];
  meanRangeDeg: number | null; meanDurationSec: number | null; rangeVariationDeg: number | null; timingVariationSec: number | null;
  trackedMs: number; lostMs: number; interruptions: number; reason: string | null;
}
export interface MovementResults {
  status: 'not-started' | 'completed' | 'partial' | 'skipped' | 'aborted' | 'unavailable';
  plan: ExerciseID[]; attempts: MovementAttempt[]; reason: string | null;
}
export interface CognitiveResults {
  checkId: string; version: number; metric: {id: string; value: number | null; unit: string; direction: 'lower' | 'higher'};
  valid: boolean; reason: string | null; source: 'live' | 'simulated';
  extras: {label: string; value: string | number; flag: boolean}[]; flags: Record<string, number>; startedAt: string; completedAt: string;
}
export interface Session {
  checkIn: {sleepMinutes: number | null; sleepiness: number | null; at: string};
  cognitiveResults: CognitiveResults | null;
  movementResults: MovementResults;
  context: {
    schemaVersion: 2; sessionId: string; startedAt: string; updatedAt: string; mission: string; profileScope: string;
    environment: 'earth-training'; order: ['check-in', 'cognitive', 'movement']; routineVersion: 2; modelVersion: 'pose-landmarker-lite'; sdkVersion: '0.10.32';
    baseline: {cognitive: 'none' | 'forming' | 'local-recent' | 'simulated-fixture'; movement: Partial<Record<ExerciseID, 'forming' | 'local-recent'>>};
    agreement: {step: string; discussed: boolean} | null;
  };
  syncStatus: {state: 'local-only' | 'not-saved'; at: string; reason: string | null};
}
export interface Tracker {
  exercise: ExerciseID; phase: string; side: 'left' | 'right' | null; stable: number; lastMs: number | null; angle: number | null;
  phaseAt: number | null; repAt: number | null; minAngle: number; maxAngle: number; reps: RepObservation[];
  trackedMs: number; lostMs: number; interruptions: number; lost: boolean;
}
