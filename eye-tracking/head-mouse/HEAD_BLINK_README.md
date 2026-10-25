# Head mouse with three-second right wink

Run `start-head-blink-mouse.cmd` or `head_blink_mouse.py` with Python (see requirements.txt in the project root).
Keep the script in this folder alongside head_mouse_core.py and the parent
project's mouse.py, retraining/schema.py and models/face_landmarker.task.

1. Face the camera with both eyes open. No target calibration or pose collection.
2. Optional practice while paused: hold YOUR RIGHT eye closed for three seconds,
   keeping LEFT open. TEST clicks should increase once; no mouse click is sent.
3. F8 starts head control and wink clicks. Small head movements steer the cursor.
   Hold the right wink three seconds for one LEFT click; reopen both eyes for
   at least half a second to rearm. The pointer freezes during a recognized wink.
4. Esc stops globally. F8 pauses/resumes, F9 recenters, F10 toggles wink clicking.
   Tracking loss pauses control and requires F8 to resume. Changing distance
   significantly also requires recentering. Physical mouse does not auto-pause.

Live eye scores and progress are visible. Default right-closed threshold is .65;
left-open maximum is .35. If necessary adjust the sliders using observed scores.
A held wink uses a slightly lower right-eye release threshold to reduce jitter.
Invalid threshold ordering prevents clicks. Left winks, both-eye closure, short
blinks, tracking loss and interrupted holds do not click. Head movement remains
available even if eye scores are uncertain; only a recognized held wink freezes
the pointer. No right-click, scrolling or dragging gesture is implemented.

The official pretrained MediaPipe Face Landmarker model supplies landmarks and
eye-expression scores. It was already downloaded and its hash is verified; no
retraining, Gaze360, GazePointer, account or network service is used. These scores
are not calibrated blink probabilities. Your own long-wink accuracy still needs
a live check. The previous head mapping is reused with smoothing and speed limit.

Numeric session/status records are under blink-runs/. Camera images are not saved.
All earlier images, models, calibrations and applications are preserved. Optional
--events-jsonl emits click/test_click/enabled/recentered events for a parent UI.
Click coordinates are normalized to the primary display; a click event reports an
OS click already sent, so do not execute another click in response. Works directly
with a web UI through the Windows mouse. Windows and existing ML packages required.

Model documentation: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker

## Blink transition repair

The timer now allows up to 250ms of uncertain eyelid travel before closure and
150ms of brief uncertainty during an active wink. Uncertain intervals do not
count toward the required THREE seconds of confirmed right-eye closure.
Left/bilateral closure and tracking loss still cancel immediately. The status
shows readiness, confirmed hold duration, and cancellation reason. Recent numeric
eye scores are saved in session.json for diagnosis; camera images remain unsaved.
The software passed 13 tests including gradual eyelid travel. This does not
establish that current thresholds recognize every person's wink.
