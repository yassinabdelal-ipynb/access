"""Keep head control on one person.

The face detector can see several people. Head control must follow exactly one head and ignore everyone else:

* The first time (or after the person has been gone for LOSE_AFTER seconds) it picks the nearest face:
  the one whose eyes are farthest apart in the picture.
* After that it stays on that same head: the face closest to where that head was a moment ago, and about the
  same size. Someone else walking into view, even someone nearer, never takes over while the original is still there.
* If the original is hidden for a moment while someone else is in view, nothing is followed (head control waits)
  instead of jumping to the other person.

Pure Python with no camera or model, so it can be tested directly.
"""
import math

LOSE_AFTER = 1.5       # seconds without the original head before the nearest face is chosen again
BASE_JUMP = 1.5        # how far (in eye-spans) the head may move between two frames
JUMP_PER_SECOND = 1.5  # extra allowance for every second the head was not seen
MAX_JUMP = 4.0
SIZE_RANGE = (.7, 1.45) # a face this much smaller or larger than the original is a different person


class FaceLock:
    def __init__(self):
        self.reset()

    def reset(self):
        self.center = None
        self.span = None
        self.seen = None

    @property
    def locked(self):
        return self.center is not None

    def _take(self, candidate, now):
        self.center = tuple(candidate['center'])
        self.span = float(candidate['span'])
        self.seen = now

    def choose(self, candidates, now):
        """candidates: [{'center': (x, y), 'span': float}, ...] in pixels. Returns the index to follow, or None."""
        usable = [i for i, c in enumerate(candidates) if c['span'] > 0 and all(math.isfinite(v) for v in c['center'])]
        nearest = lambda: max(usable, key=lambda i: candidates[i]['span'])
        if self.center is None:
            if not usable:
                return None
            index = nearest()
            self._take(candidates[index], now)
            return index

        gap = max(0., now - self.seen)
        allowed = min(MAX_JUMP, BASE_JUMP + JUMP_PER_SECOND * gap)
        best = None
        best_distance = None
        for index in usable:
            c = candidates[index]
            distance = math.hypot(c['center'][0] - self.center[0], c['center'][1] - self.center[1]) / max(self.span, 1.)
            ratio = c['span'] / self.span
            if distance <= allowed and SIZE_RANGE[0] <= ratio <= SIZE_RANGE[1]:
                if best is None or distance < best_distance:
                    best, best_distance = index, distance
        if best is not None:
            c = candidates[best]
            # Follow slowly changing size so leaning in or out does not look like a new person.
            self.center = tuple(c['center'])
            self.span = .7 * self.span + .3 * float(c['span'])
            self.seen = now
            return best

        if gap > LOSE_AFTER:
            # The original head has been gone long enough: start over with whoever is nearest (if anyone).
            self.reset()
            if not usable:
                return None
            index = nearest()
            self._take(candidates[index], now)
            return index
        return None