"""Shared, versioned capture format. Stores local eye crops, never full frames."""
import hashlib
import json
import os
from pathlib import Path
import time
import uuid
import numpy as np
from PIL import Image

LABELS=("center","close","down","left","right","up")
IMAGE_SIZE=224
SCHEMA_VERSION=1
INPUT_PROFILE="right_equalized"
MIN_TRIALS_PER_CLASS=8
MIN_SAMPLES_PER_TRIAL=12
MIN_SESSIONS={"train":3,"validation":1,"test":1}
SESSION_PLAN=("train","train","validation","train","test")
SPLITS=tuple(MIN_SESSIONS)

def sha256_file(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as f:
        for part in iter(lambda:f.read(1024*1024),b""):h.update(part)
    return h.hexdigest()

def atomic_json(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    # A reader/antivirus can briefly prevent replacement on Windows. Keep
    # the old complete file intact and use a unique temporary file per writer.
    temp=path.with_name(path.name+"."+uuid.uuid4().hex+".tmp")
    try:
        temp.write_text(json.dumps(value,indent=2,allow_nan=False),encoding="utf-8")
        for attempt in range(8):
            try:
                os.replace(temp,path)
                break
            except PermissionError:
                if attempt==7:raise
                time.sleep(min(.01*2**attempt,.25))
    finally:
        try:temp.unlink(missing_ok=True)
        except OSError:pass

def next_split(root):
    completed={s:0 for s in SPLITS}
    for path in (Path(root)/"sessions").glob("*/session.json"):
        item=json.loads(path.read_text(encoding="utf-8"))
        if item.get("status")=="complete" and item.get("split") in completed:
            completed[item["split"]]+=1
    for split in SESSION_PLAN:
        if completed[split]:
            completed[split]-=1
        else:return split
    return "train"

class SessionWriter:
    """One explicit recording session, assigned one immutable data split."""
    def __init__(self,root,split,metadata=None):
        if split not in SPLITS:raise ValueError("Unknown split")
        self.root=Path(root).resolve()
        self.session_id=time.strftime("%Y%m%d-%H%M%S")+"-"+uuid.uuid4().hex[:8]
        self.folder=self.root/"sessions"/self.session_id
        self.folder.mkdir(parents=True,exist_ok=False)
        self.manifest=self.folder/"manifest.jsonl"
        self.manifest.touch()
        self.info={"schema_version":SCHEMA_VERSION,"session_id":self.session_id,
            "split":split,"status":"recording","created_at":time.time(),
            "image_size":IMAGE_SIZE,"stored_profile":"raw_grayscale_nearest",
            "training_profile":INPUT_PROFILE,"labels":list(LABELS),
            "metadata":metadata or {},"trials_per_class":{k:0 for k in LABELS},
            "samples_per_class":{k:0 for k in LABELS}}
        self.sequences=set()
        self._save()
    def _save(self):atomic_json(self.folder/"session.json",self.info)
    def write_trial(self,label,target,frames,metadata=None):
        if self.info["status"]!="recording":raise ValueError("Session is closed")
        if label not in LABELS:raise ValueError("Unknown label")
        if len(frames)<MIN_SAMPLES_PER_TRIAL:raise ValueError("Too few samples for an independent bout")
        if label=="close":
            if target is not None:raise ValueError("Closed eyes have no gaze coordinate")
        elif target is None or len(target)!=2 or not all(np.isfinite(v) and 0<=v<=1 for v in target):
            raise ValueError("Open-eye samples need the displayed screen target")
        trial_id=uuid.uuid4().hex[:12]
        sequences=[int(v["sequence"]) for v in frames]
        if len(set(sequences))!=len(sequences) or self.sequences.intersection(sequences):
            raise ValueError("A camera frame cannot be labeled twice")
        for frame in frames:
            for side in ("right","left"):
                eye=np.asarray(frame[side])
                if eye.shape!=(IMAGE_SIZE,IMAGE_SIZE) or eye.dtype!=np.uint8:
                    raise ValueError("Expected exact uint8 224x224 raw crop")
        rows=[]
        for index,frame in enumerate(frames):
            row={k:v for k,v in frame.items() if k not in ("right","left")}
            row.update(schema_version=SCHEMA_VERSION,
                sample_id=f"{self.session_id}/{trial_id}/{index:03d}",
                session_id=self.session_id,trial_id=trial_id,split=self.info["split"],
                label=label,target_normalized=None if target is None else list(target),
                trial_metadata=metadata or {})
            for side in ("right","left"):
                relative=Path("sessions")/self.session_id/"eyes"/trial_id/f"{index:03d}-{side}.png"
                path=self.root/relative;path.parent.mkdir(parents=True,exist_ok=True)
                Image.fromarray(frame[side]).save(path,format="PNG")
                row[side+"_path"]=relative.as_posix()
                row[side+"_sha256"]=sha256_file(path)
            # Fail before manifest commit if metadata contains NaN or unsupported values.
            json.dumps(row,allow_nan=False)
            rows.append(row)
        with self.manifest.open("a",encoding="utf-8") as f:
            for row in rows:f.write(json.dumps(row,allow_nan=False)+"\n")
            f.flush();os.fsync(f.fileno())
        self.sequences.update(sequences)
        self.info["trials_per_class"][label]+=1
        self.info["samples_per_class"][label]+=len(rows)
        self._save()
        return trial_id
    def mark_complete(self):
        if self.info["status"]!="recording":raise ValueError("Only a recording session can be completed")
        if not all(n>=MIN_TRIALS_PER_CLASS for n in self.info["trials_per_class"].values()):
            raise ValueError("Each class needs eight separately armed capture bouts")
        self.info["status"]="complete";self.info["completed_at"]=time.time();self._save()
    def close(self):
        if self.info["status"]=="recording":
            self.info["status"]="partial";self.info["closed_at"]=time.time();self._save()
