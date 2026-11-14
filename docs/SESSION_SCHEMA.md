# Local session schema 2

Each assessment has exactly five sections: `checkIn`, `cognitiveResults`, `movementResults`, `context`, `syncStatus`. Identity and version stay in `context`. The local crew position/call sign is a browser profile label, not an authenticated account.

```json
{
  "checkIn": {"sleepMinutes":420,"sleepiness":2,"at":"2026-11-14T12:00:00.000Z"},
  "cognitiveResults": {"checkId":"capture","version":1,"metric":{"id":"cygnus","value":610,"unit":"ms","direction":"lower"},"valid":true,"reason":null,"source":"live","extras":[],"flags":{},"startedAt":"2026-11-14T12:00:00.000Z","completedAt":"2026-11-14T12:01:00.000Z"},
  "movementResults": {"status":"not-started","plan":["side-view-squat","overhead-reach"],"attempts":[],"reason":null},
  "context": {"schemaVersion":2,"sessionId":"00000000-0000-4000-8000-000000000001","startedAt":"2026-11-14T12:00:00.000Z","updatedAt":"2026-11-14T12:01:00.000Z","mission":"cygnus","profileScope":"local:CDR:ORION","environment":"earth-training","order":["check-in","cognitive","movement"],"routineVersion":2,"modelVersion":"pose-landmarker-lite","sdkVersion":"0.10.32","baseline":{"cognitive":"forming","movement":{}},"agreement":null},
  "syncStatus": {"state":"local-only","at":"2026-11-14T12:01:00.000Z","reason":null}
}
```

`checkIn` stores minutes of sleep (0–899), sleepiness (integer 1–5), and an ISO timestamp. Missing values are null. The form requests both sleep fields before a check.

`cognitiveResults` preserves the mission metric, structured extras and error flags. Cargo, docking, water and drill use milliseconds; solar uses percent of scale; ultrasound and experiment use observed task percentages. `source` is `live` or `simulated`, independently of reference provenance. Missions 5–7 use check version 2 after upstream commit `42edd9c`; the other four use version 1. Invalid/nonfinite primary metrics are null with a reason.

`movementResults.plan` contains two distinct exercise IDs from `side-view-squat`, `overhead-reach`, `t-pose-open`. The first assessment uses the operation to choose a starting exercise; later assessments rotate from the previous saved plan for that profile, including after the history cap is reached. Users can change the current movement. `attempts[i]` belongs to `plan[i]` and contains:

```json
{"exercise":"overhead-reach","view":"front","calibration":"stable-pose-v2","protocolVersion":2,"status":"completed","source":"camera","reps":3,"targetReps":3,"repetitions":[{"rangeDeg":154.2,"durationSec":2.1},{"rangeDeg":151.8,"durationSec":2.3},{"rangeDeg":155.1,"durationSec":2.0}],"meanRangeDeg":153.7,"meanDurationSec":2.13,"rangeVariationDeg":3.3,"timingVariationSec":0.3,"trackedMs":8200,"lostMs":0,"interruptions":0,"reason":null}
```

Angles are monocular 2D estimates in degrees. Repetition duration is in seconds; tracked/lost durations are milliseconds; variation is maximum minus minimum across completed repetitions. No frames, images, videos or per-frame landmarks are stored. A skipped/unavailable attempt has null source/count/aggregates, an empty repetition array and a reason. Attempt statuses are `completed`, `skipped`, `aborted`, `insufficient-data`, `unavailable`. Overall movement statuses are `not-started`, `completed`, `partial`, `skipped`, `aborted`, `unavailable`.

The assessment ID is stable across cognitive completion, both movement blocks, results, export and agreement edits. Updates upsert that ID. Each new assessment/repeat creates a new ID, an empty attempt list and a zeroed UI. Between movements the camera is disposed; the user explicitly starts the next block. A stopped/retried block replaces its current attempt. Navigation/hidden-tab interruption saves an aborted attempt and invalidates late work.

Storage uses `crewready.v5.sessions`, maximum 30 sessions, 140,000 UTF-8 bytes overall and 16,000 bytes per row. Repetitions are capped at 20 per attempt; attempts at two; extras/flags at 20; agreement at 500 characters. Nonfinite and malformed data is rejected. Corrupt/disabled/quota storage produces an honest warning and `not-saved` status. Clearing history removes v5 plus legacy v3/v4 keys and prevents re-saving the current in-memory session until a new assessment starts.

Previous v3/v4 data stays untouched until the user clears it. It lacks the new crew profile/routine context, so it is not silently assigned to a crew member or used as a new movement reference. This avoids carrying an old squat result such as 3/3 into a new test.

Cognitive comparisons use five prior compatible valid live samples for the same mission, check version and local profile. Simulated measurements never train live references. A live result may be compared with a visibly labeled simulated cognitive fixture. Zero/near-zero reference metrics do not produce percentage differences. The original illustrative rule remains `task ≥20% worse AND (sleep ≥120 minutes shorter OR sleepiness ≥4/5)`.

Movement references are separate for each exercise and require five prior completed camera attempts with matching profile, protocol, Earth environment, view and calibration. The current ID is excluded. Recent medians and changes are reported in degrees/seconds without calling a slower or smaller movement medically worse. `context.baseline` records reference provenance. No readiness percentage or operational clearance is computed.

`syncStatus` is `local-only` after a successful browser save or `not-saved` with a reason. There is no server or simulated transmission to Earth.
