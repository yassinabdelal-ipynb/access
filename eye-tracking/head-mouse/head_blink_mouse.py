"""Head-controlled mouse + pretrained right-eye closure detection (3 seconds).

Uses the existing official MediaPipe Face Landmarker model. No gaze calibration,
Gaze360 inference, training, account, network API, or four-pose setup is needed.
Starts when a stable face is detected (use --paused for TEST-only startup).
F8 toggles automatic control. F9 recenters. Esc explicitly pauses.
"""
import argparse
from collections import deque
from datetime import datetime
from pathlib import Path
import sys
import threading
import time
import uuid
import json
import math
import queue
import os
from head_settings import load as load_settings, save as save_settings

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
sys.path.insert(0,str(ROOT))
import numpy as np
from head_mouse_core import Pointer
from face_lock import FaceLock


class WinkHold:
    def __init__(self,seconds=3.):
        self.seconds=seconds
        self.reset()

    def reset(self):
        self.last=self.open_since=self.start=self.anchor=None
        self.armed=self.fired=False
        self.progress=0.
        self.frames=0
        self.uncertain_since=None
        self.confirmed=0.
        self.previous_state=None
        self.cancel_reason=None

    @property
    def frozen(self):return self.start is not None

    def step(self,stamp,state,point):
        if self.last is not None and stamp<=self.last:return None
        if self.last is not None and stamp-self.last>.3:
            self.reset();self.cancel_reason='Camera samples interrupted'
        dt=0. if self.last is None else stamp-self.last
        previous=self.previous_state
        self.last=stamp
        self.previous_state=state
        if state=='uncertain':
            if self.uncertain_since is None:self.uncertain_since=stamp
            # Allow eyelid travel before closure and a very short score wobble
            # during it. Uncertain time NEVER contributes to the 3-second hold.
            grace=.25
            if (self.armed or self.frozen) and stamp-self.uncertain_since<=grace:
                return None
            self.reset();self.last=stamp;self.previous_state=state
            self.cancel_reason='Eye scores uncertain too long; reopen both eyes'
            return None
        if self.uncertain_since is not None:
            grace=.25
            if stamp-self.uncertain_since>grace:
                self.reset();self.last=stamp;self.previous_state=state
                self.cancel_reason='Closing transition interrupted; reopen both eyes'
                previous=None;dt=0.
            self.uncertain_since=None
        if state=='open':
            if self.start is not None:self.armed=False;self.open_since=None
            self.start=self.anchor=None;self.fired=False;self.progress=0.
            self.confirmed=0.
            if self.open_since is None:self.open_since=stamp
            if stamp-self.open_since>=.5:self.armed=True
            return None
        if state=='right':
            self.open_since=None
            if self.start is None and self.armed and point is not None and all(math.isfinite(v) for v in point):
                self.start=stamp;self.anchor=tuple(point);self.armed=False;self.frames=0
                self.confirmed=0.;self.cancel_reason=None
            if self.start is not None:
                self.frames+=1
                if self.frames>1 and previous=='right':self.confirmed+=dt
                self.progress=min(1.,self.confirmed/self.seconds)
                if not self.fired and self.confirmed>=self.seconds and self.frames>=10:
                    self.fired=True
                    return self.anchor
            return None
        self.reset();self.last=stamp
        self.previous_state=state
        self.cancel_reason={'both':'Both eyes closed; reopen both eyes','left':'Left eye closed; use RIGHT eye',
                            'invalid':'Invalid eye reading'}.get(state,state)
        return None


def eye_state(left,right,closed=.65,opened=.35,holding=False):
    if not all(math.isfinite(v) and 0<=v<=1 for v in (left,right)):
        return 'invalid'
    if not 0<=opened<closed<=1:return 'invalid'
    # Holding must be easier than starting, even when the saved open/closed
    # thresholds are almost equal. Require asymmetry to reject bilateral blinks.
    if holding:
        release=max(.15,closed-.12)
        left_ceiling=min(.60,opened+.06)
        if right<=release and left<=left_ceiling:return 'open'
        if left<=left_ceiling and right>=release and right-left>=.08:return 'right'
    elif left<=opened and right>=closed:return 'right'
    if left<=opened and right<=opened:return 'open'
    if left>=closed and right>=closed:return 'both'
    if left>=closed and right<=opened:return 'left'
    return 'uncertain'


# Landmark groups drawn as a schematic face mask in the browser (no camera image is ever sent).
# Order matters: the browser knows the group lengths (36,16,16,10,10,10,20,20).
FACE_GROUPS=[
    [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109],
    [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246],
    [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398],
    [70,63,105,66,107,55,65,52,53,46],
    [300,293,334,296,336,285,295,282,283,276],
    [168,6,197,195,5,4,1,19,94,2],
    [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185],
    [78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191],
]
FACE_INDEX=[i for group in FACE_GROUPS for i in group]
FACE_SHAPES=('eyeBlinkLeft','eyeBlinkRight','jawOpen','mouthSmileLeft','mouthSmileRight','browInnerUp')

class Worker(threading.Thread):
    def __init__(self,camera=0):
        super().__init__(daemon=True)
        self.camera=camera;self.stop=threading.Event();self.latest=None;self.error=None

    def run(self):
        cap=model=None
        try:
            import cv2
            # This MediaPipe build imports TensorFlow solely for optional API-doc
            # decorators (tasks/python/core/optional_dependencies.py). Use its
            # documented missing-dependency fallback in this standalone process;
            # the Face Landmarker inference runtime does not require TensorFlow.
            # AudioRecord also has an optional-import fallback. This mouse uses
            # no audio; avoid initializing PortAudio and its shutdown handler.
            skipped=[name for name in ('tensorflow','sounddevice') if name not in sys.modules]
            for name in skipped:sys.modules[name]=None
            try:import mediapipe as mp
            finally:
                for name in skipped:sys.modules.pop(name,None)
            opts=mp.tasks.vision.FaceLandmarkerOptions(
                base_options=mp.tasks.BaseOptions(model_asset_buffer=(ROOT/'models/face_landmarker.task').read_bytes()),
                running_mode=mp.tasks.vision.RunningMode.VIDEO,num_faces=5,
                min_face_detection_confidence=.6,min_face_presence_confidence=.6,
                min_tracking_confidence=.6,output_face_blendshapes=True)
            model=mp.tasks.vision.FaceLandmarker.create_from_options(opts)
            cap=cv2.VideoCapture(self.camera,cv2.CAP_DSHOW)
            if not cap.isOpened():raise RuntimeError('Camera unavailable. Close other camera apps and restart.')
            cap.set(cv2.CAP_PROP_FRAME_WIDTH,640);cap.set(cv2.CAP_PROP_FRAME_HEIGHT,480)
            seq=0;previous_ms=-1;lock=FaceLock()
            while not self.stop.is_set():
                ok,bgr=cap.read();stamp=time.monotonic()
                if not ok:raise RuntimeError('Camera stopped returning frames.')
                seq+=1;h,w=bgr.shape[:2]
                ms=max(previous_ms+1,int(stamp*1000));previous_ms=ms
                result=model.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,
                    data=np.ascontiguousarray(cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB))),ms)
                p=dict(sequence=seq,timestamp=stamp,valid=False,left=None,right=None,
                       preview=cv2.resize(bgr,(360,270)),reason='Keep one face visible.')
                # Several people may be in view. Follow one head only: the nearest at first, then the same head
                # (see face_lock.py). Anyone else is ignored, even if they come closer.
                faces=[]
                for lm,blend in zip(result.face_landmarks,result.face_blendshapes):
                    fp=np.array([(v.x*w,v.y*h) for v in lm])
                    fa=(fp[33]+fp[133])/2;fb=(fp[362]+fp[263])/2
                    faces.append(dict(pts=fp,blend=blend,span=float(np.linalg.norm(fa-fb)),point=.7*fp[1]+.3*(fa+fb)/2,eyes=(fa+fb)/2,center=tuple(.7*fp[1]+.3*(fa+fb)/2)))
                pick=lock.choose(faces,stamp)
                p['faces']=len(faces)
                if pick is None and faces:p['reason']='Another person is in view. Waiting for you.'
                if pick is not None:
                    face=faces[pick];pts=face['pts'];span=face['span'];point=face['point']
                    scores={s.category_name:float(s.score) for s in face['blend']}
                    left,right=scores.get('eyeBlinkLeft'),scores.get('eyeBlinkRight')
                    if span>25 and np.isfinite(point).all() and left is not None and right is not None:
                        p.update(valid=True,point=point.tolist(),span=span,left=left,right=right,reason='Tracking')
                        p['face']=dict(pts=[round(float(c),3) for i in FACE_INDEX for c in (pts[i][0]/w,pts[i][1]/h)],b=[round(float(scores.get(k,0)),2) for k in FACE_SHAPES])
                        dot=tuple((point*np.array([360/w,270/h])).astype(int))
                        cv2.circle(p['preview'],dot,5,(50,240,100),-1)
                    else:p['reason']='Move a little closer so your eyes are visible.'
                p['latency_ms']=(time.monotonic()-stamp)*1000
                self.latest=p
        except Exception as exc:
            import traceback
            self.error=str(exc);traceback.print_exc(file=sys.stderr)
        finally:
            if cap is not None:cap.release()
            if model is not None:model.close()


class App:
    def __init__(self,root,args):
        import tkinter as tk
        from tkinter import ttk
        from mouse import Mouse
        from retraining.schema import atomic_json
        self.root,self.args,self.write=root,args,atomic_json
        self.mouse=Mouse();self.pointer=Pointer((self.mouse.width,self.mouse.height));self.wink=WinkHold(3.)
        self.settings=load_settings()
        if args.camera is None:args.camera=self.settings['camera']
        self.worker=Worker(args.camera)
        self.commands=queue.Queue();self.auto_requested=not args.bridge and not args.smoke_seconds and not args.paused;self.lease_until=0.;self.last_status=0.;self.last_face=0.
        if args.bridge:
            def listen():
                buffer=b''
                try:
                    # Raw reads avoid holding Python's buffered-stdin lock at shutdown.
                    while True:
                        chunk=os.read(sys.stdin.fileno(),4096)
                        if not chunk:break
                        buffer+=chunk
                        if len(buffer)>65536:buffer=b''
                        while b'\n' in buffer:
                            line,buffer=buffer.split(b'\n',1)
                            try:self.commands.put(json.loads(line))
                            except ValueError:pass
                finally:self.commands.put({'command':'quit'})
            threading.Thread(target=listen,daemon=True).start()
        self.history=deque(maxlen=30);self.last_seq=-1;self.last_tick=time.monotonic();self.last_save=0
        self.keys={};self.enabled=False;self.closed=False;self.events=[];self.clicks=self.tests=0
        self.state='waiting';self.last_open=None;self.last_open_stamp=None
        self.diagnostics=deque(maxlen=150);self.last_diagnostic=0.
        self.folder=HERE/'blink-runs'/(datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6])
        self.folder.mkdir(parents=True,exist_ok=False)
        root.title('Head mouse + RIGHT wink 3s | F8 start | Esc stop')
        root.geometry('580x950+25+25')
        self.status=tk.StringVar(value='Waiting for your face; head control starts automatically. Esc pauses.' if self.auto_requested else 'Loading camera. Mouse / trackpad mode.')
        self.scores=tk.StringVar(value='Pretrained eye-closure detector loading...')
        self.count=tk.StringVar(value='TEST clicks: 0 | Real clicks: 0')
        self.hold_status=tk.StringVar(value='Open both eyes for half a second to get ready.')
        self.click_on=tk.BooleanVar(value=self.settings['clicks_enabled']);self.mirror=tk.BooleanVar(value=self.settings['mirror'])
        self.gain=tk.DoubleVar(value=self.settings['gain']);self.closed_score=tk.DoubleVar(value=self.settings['closed_threshold']);self.open_score=tk.DoubleVar(value=self.settings['open_threshold'])
        ttk.Label(root,text='Head mouse + 3-second right wink',font=('Segoe UI',16,'bold')).pack(pady=12)
        ttk.Label(root,textvariable=self.status,wraplength=550).pack()
        self.preview=ttk.Label(root);self.preview.pack(pady=8)
        row=ttk.Frame(root);row.pack()
        ttk.Button(row,text='Start / pause (F8)',command=self.toggle).pack(side='left',padx=5)
        ttk.Button(row,text='Recenter (F9)',command=self.recenter).pack(side='left',padx=5)
        ttk.Label(root,text='Move your head slightly to move the mouse.\nHold YOUR RIGHT eye closed for 3 seconds; keep LEFT open.\nOne LEFT click. Reopen both eyes before the next click.',wraplength=550).pack(pady=8)
        ttk.Checkbutton(root,text='Enable 3-second right-wink clicks (F10)',variable=self.click_on,command=self.reset_wink).pack()
        self.bar=ttk.Progressbar(root,maximum=1,length=460);self.bar.pack(pady=8)
        ttk.Label(root,textvariable=self.scores,wraplength=550).pack()
        ttk.Label(root,textvariable=self.count).pack(pady=5)
        ttk.Label(root,textvariable=self.hold_status,wraplength=550).pack()
        ttk.Label(root,text='Head movement sensitivity').pack()
        ttk.Scale(root,from_=.35,to=2.2,variable=self.gain,length=420).pack()
        ttk.Checkbutton(root,text='Mirror head movement',variable=self.mirror,command=self.recenter).pack()
        ttk.Separator(root).pack(fill='x',padx=15,pady=10)
        ttk.Label(root,text='If a held wink is not recognized, adjust using the live scores.').pack()
        ttk.Label(root,text='Right-eye closed threshold (lower = easier to trigger)').pack()
        ttk.Scale(root,from_=.40,to=.90,variable=self.closed_score,length=420,command=lambda v:self.reset_wink()).pack()
        ttk.Label(root,text='Left-eye open maximum (higher = more tolerant)').pack()
        ttk.Scale(root,from_=.10,to=.50,variable=self.open_score,length=420,command=lambda v:self.reset_wink()).pack()
        ttk.Label(root,text='Esc stops globally. Paused mode only counts TEST clicks.\nNo gaze targets or eye-pose calibration required.',wraplength=550).pack(pady=10)
        root.protocol('WM_DELETE_WINDOW',self.close)
        for var in (self.click_on,self.mirror,self.gain,self.closed_score,self.open_score):
            var.trace_add('write',lambda *_:self.persist())
        self.persist()
        self.worker.start();root.after(20,self.tick)
        # Started by the browser: stay out of sight (no window, no taskbar button). The camera is used in the background.
        if args.bridge and not args.smoke_seconds:root.after(1,root.withdraw)
        if args.smoke_seconds:root.after(int(args.smoke_seconds*1000),self.close)

    def persist(self):
        try:
            self.settings=save_settings(dict(closed_threshold=self.closed_score.get(),
                open_threshold=self.open_score.get(),gain=self.gain.get(),mirror=self.mirror.get(),
                clicks_enabled=self.click_on.get(),camera=self.args.camera))
        except ValueError:
            pass  # A slider can temporarily cross the other threshold; retain last valid settings.

    def bridge_tick(self,now):
        while not self.commands.empty():
            command=self.commands.get().get('command')
            if command=='quit':self.close();return False
            if command=='head':
                self.auto_requested=not self.args.smoke_seconds;self.lease_until=now+6
                self.status.set('Starting head control with saved settings...')
            elif command=='manual':
                self.pause('Mouse / trackpad mode. Head control paused.')
            elif command=='heartbeat':self.lease_until=now+6
            elif command=='recenter' and self.enabled:self.recenter()
        if self.args.bridge and now>self.lease_until:
            if self.enabled or self.auto_requested:
                self.pause('Browser disconnected. Head control paused.')
        if self.args.bridge and now-self.last_status>.25:
            self.last_status=now
            print(json.dumps(dict(type='status',enabled=self.enabled,pending=self.auto_requested and not self.enabled,auto_requested=self.auto_requested,
                message=self.status.get(),progress=self.wink.progress,error=self.worker.error,
                clicks=self.clicks,clicks_enabled=self.click_on.get(),wink_state=self.state,hold_seconds=self.wink.confirmed,wink_armed=self.wink.armed,cancel_reason=self.wink.cancel_reason)),flush=True)
        return True

    def emit(self,kind,**kw):
        event=dict(type=kind,timestamp=time.time(),**kw)
        self.events.append(event)
        if self.args.events_jsonl:print(json.dumps(event),flush=True)

    def reset_wink(self):
        self.wink.reset();self.last_open=self.last_open_stamp=None

    def pause(self,message,transient=False):
        changed=self.enabled or (self.auto_requested and not transient) or self.status.get()!=message
        self.enabled=False
        if not transient:self.auto_requested=False
        self.reset_wink();self.status.set(message)
        if changed:self.emit('waiting_for_face' if transient else 'paused',reason=message)

    def maybe_start(self,now):
        if not self.auto_requested or self.enabled or self.args.smoke_seconds:return False
        if self.args.bridge and now>self.lease_until:return False
        recent=[p for p in self.history if 0<=now-p['timestamp']<.7]
        if len(recent)<5 or recent[-1]['timestamp']-recent[0]['timestamp']<.4:return False
        if self.recenter():
            self.enabled=True;self.status.set('Face detected: head control ON. RIGHT wink 3 seconds clicks. Esc pauses.')
            self.emit('enabled',automatic=True);return True
        return False

    def recenter(self):
        recent=[p for p in self.history if 0<=time.monotonic()-p['timestamp']<.7]
        if len(recent)<5:self.status.set('Face the camera for a moment, then press F8.');return False
        point=np.median([p['point'] for p in recent],axis=0)
        span=float(np.median([p['span'] for p in recent]))
        self.pointer.mirror=self.mirror.get();self.pointer.center(point,span,self.mouse.position())
        self.reset_wink();self.emit('recentered');return True

    def toggle(self):
        if self.args.smoke_seconds:return
        if self.args.bridge and time.monotonic()>self.lease_until:
            self.pause('Choose Head control in Access to reconnect.');return
        if self.auto_requested or self.enabled:self.pause('Paused by F8. Mouse / trackpad mode.')
        else:
            self.auto_requested=True;self.status.set('Waiting for your face; control resumes automatically.')

    def pressed(self,key):
        down=self.mouse.down(key);old=self.keys.get(key,False);self.keys[key]=down
        return down and not old

    def save(self,p=None,valid=False):
        self.write(self.folder/'session.json',dict(mode='head position + pretrained right-eye closure',hold_seconds=3,
            enabled=self.enabled,auto_requested=self.auto_requested,clicks_enabled=self.click_on.get(),test_clicks=self.tests,real_clicks=self.clicks,
            closed_threshold=self.closed_score.get(),open_threshold=self.open_score.get(),
            events=self.events,recent_eye_diagnostics=list(self.diagnostics),raw_images_saved=False,training_started=False))
        self.write(self.folder/'runtime.json',dict(valid=bool(valid),error=self.worker.error,enabled=self.enabled,auto_requested=self.auto_requested,
            state=self.state,progress=self.wink.progress,test_clicks=self.tests,real_clicks=self.clicks,
            left=p.get('left') if p else None,right=p.get('right') if p else None,
            latency_ms=p.get('latency_ms') if p else None,status=self.status.get(),
            wink_armed=self.wink.armed,confirmed_hold_seconds=self.wink.confirmed,
            wink_cancel_reason=self.wink.cancel_reason,clicks_enabled=self.click_on.get()))

    def tick(self):
        if self.closed:return
        import cv2
        from PIL import Image,ImageTk
        now=time.monotonic();dt=now-self.last_tick;self.last_tick=now;p=self.worker.latest
        valid=bool(p and p['valid'] and 0<=now-p['timestamp']<.3)
        try:
            if not self.bridge_tick(now):return
            if self.pressed(0x77):self.toggle()
            if self.pressed(0x78):self.recenter()
            if self.pressed(0x79):self.click_on.set(not self.click_on.get());self.reset_wink()
            if self.pressed(0x1B):self.pause('Stopped by Esc. TEST mode: no desktop input.')
            if self.worker.error:self.pause('Camera/model error: '+self.worker.error)
            if not valid:
                self.reset_wink();self.history.clear()
                if self.enabled:self.pause('Face lost. Waiting to resume automatically when your face returns.',transient=True)
            if p and p['sequence']!=self.last_seq:
                self.last_seq=p['sequence']
                image=ImageTk.PhotoImage(Image.fromarray(cv2.cvtColor(cv2.flip(p['preview'],1),cv2.COLOR_BGR2RGB)))
                self.preview.configure(image=image);self.preview.image=image
                if valid:
                    self.history.append(p)
                    if self.args.bridge and p.get('face') and now-self.last_face>.04:
                        self.last_face=now;print(json.dumps(dict(type='face',pts=p['face']['pts'],b=p['face']['b'])),flush=True)
                    self.maybe_start(now)
                    self.state=eye_state(p['left'],p['right'],self.closed_score.get(),self.open_score.get(),self.wink.frozen)
                    self.scores.set(f"Your RIGHT: {p['right']:.2f} | LEFT: {p['left']:.2f} | {self.state.upper()}\nThresholds: closed {self.closed_score.get():.2f}, open {self.open_score.get():.2f}")
                    if self.enabled and not .65<p['span']/self.pointer.span<1.5:
                        self.pause('Distance changed. Waiting to set a fresh neutral position.',transient=True);self.history.clear()
                    # Save only an open-eye cursor location. Keep it fixed through a wink.
                    if self.state=='open':
                        self.last_open=self.mouse.position();self.last_open_stamp=p['timestamp']
                    # Up to .25s eyelid travel plus one fresh (<.3s) camera interval.
                    anchor=self.last_open if self.last_open_stamp is not None and 0<=p['timestamp']-self.last_open_stamp<=.55 else None
                    result=self.wink.step(p['timestamp'],self.state,anchor) if self.click_on.get() else None
                    if now-self.last_diagnostic>=.1:
                        self.diagnostics.append(dict(t=now,left=p['left'],right=p['right'],state=self.state,
                            armed=self.wink.armed,hold_seconds=self.wink.confirmed,reason=self.wink.cancel_reason))
                        self.last_diagnostic=now
                    if result is not None:
                        if self.enabled:
                            self.mouse.move(*result)
                            self.mouse.user32.mouse_event(0x0002,0,0,0,0)
                            self.mouse.user32.mouse_event(0x0004,0,0,0,0)
                            self.clicks+=1
                        else:self.tests+=1
                        self.emit('click' if self.enabled else 'test_click',button='left',x=result[0],y=result[1],normalized=True)
                else:self.state='no face';self.scores.set(p['reason'])
            if valid and self.enabled:
                self.pointer.gain=self.gain.get()
                if self.wink.frozen:self.mouse.move(*self.wink.anchor)
                else:
                    # Head movement remains available even if eye scores are
                    # uncertain. Only a recognized active wink freezes it.
                    position=self.pointer.update(p['point'],dt)
                    self.mouse.move(*position)
            if valid and not self.enabled and not self.auto_requested and not self.pointer.ready and len(self.history)>=10:
                self.status.set('Ready. Test a RIGHT wink for 3 seconds, or press F8 to start head control.')
            self.bar['value']=self.wink.progress
            if self.wink.fired:self.hold_status.set('Click detected. Reopen BOTH eyes before the next click.')
            elif self.wink.frozen:self.hold_status.set(f'RIGHT wink: {self.wink.confirmed:.1f} / 3.0 seconds')
            elif self.wink.armed:self.hold_status.set('Ready for RIGHT wink. Close right eye; keep left open.')
            else:self.hold_status.set(self.wink.cancel_reason or 'Open both eyes for half a second to get ready.')
            self.count.set(f'TEST clicks: {self.tests} | Real clicks: {self.clicks}')
            if now-self.last_save>2:self.save(p,valid);self.last_save=now
        except Exception as exc:
            import traceback
            self.pause('Paused after error: '+str(exc));traceback.print_exc(file=sys.stderr)
        self.root.after(16,self.tick)

    def close(self):
        self.closed=True;self.enabled=False;self.reset_wink()
        self.persist();self.save(self.worker.latest)
        self.worker.stop.set();self.worker.join(timeout=4);self.root.destroy()


def main():
    import ctypes
    import tkinter as tk
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--camera',type=int,default=None)
    parser.add_argument('--bridge',action='store_true')
    parser.add_argument('--paused',action='store_true',help='Start in TEST mode without automatic desktop control')
    parser.add_argument('--smoke-seconds',type=float,default=0)
    parser.add_argument('--events-jsonl',action='store_true')
    args=parser.parse_args()
    try:ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except (OSError,AttributeError):pass
    # Reserve a local port only as a single-instance lock; no network commands are accepted.
    import socket
    lock=socket.socket()
    try:lock.bind(('127.0.0.1',49673))
    except OSError:
        print('Head mouse already running. Close its window before starting another.',file=sys.stderr)
        return
    try:
        root=tk.Tk();App(root,args);root.mainloop()
    finally:lock.close()


if __name__=='__main__':main()
