"""Persistent personal settings. Enabling desktop control is never persisted."""
import json
import math
from pathlib import Path

DEFAULTS = dict(version=1, closed_threshold=0.4566502463054187,
                open_threshold=0.4517241379310345, gain=1.1, mirror=True,
                clicks_enabled=True, camera=0, hold_seconds=3)
SETTINGS = Path(__file__).resolve().parent / 'settings.json'

def validate(value):
    out = {**DEFAULTS, **{k: v for k, v in value.items() if k in DEFAULTS}}
    for name, lo, hi in [('closed_threshold', .4, .9), ('open_threshold', .1, .5), ('gain', .35, 2.2)]:
        v = out[name]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
            raise ValueError('Invalid setting: ' + name)
    if out['open_threshold'] >= out['closed_threshold']:
        raise ValueError('Open threshold must be below closed threshold')
    if type(out['mirror']) is not bool or type(out['clicks_enabled']) is not bool:
        raise ValueError('Invalid boolean setting')
    if type(out['camera']) is not int or not 0 <= out['camera'] <= 9:
        raise ValueError('Invalid camera')
    out['version'], out['hold_seconds'] = 1, 3
    return out

def load(path=SETTINGS):
    try:
        return validate(json.loads(path.read_text(encoding='utf-8')))
    except (OSError, ValueError, TypeError, AttributeError):
        return DEFAULTS.copy()

def save(value, path=SETTINGS):
    out = validate(value)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
    temp.replace(path)
    return out
