"""Head pointer and dwell policy, without camera or OS side effects."""
import math
import numpy as np

class Pointer:
    def __init__(self,size):
        self.size=np.asarray(size,float); self.gain=1.1; self.mirror=True; self.ready=False
    def center(self,point,span,cursor):
        if span<20 or not np.isfinite([*point,span,*cursor]).all(): raise ValueError('Invalid head reference')
        self.anchor=np.array(point,float); self.span=float(span); self.origin=np.asarray(cursor,float)
        self.position=self.origin.copy(); self.ready=True
    def update(self,point,dt):
        if not self.ready: return None
        delta=(np.asarray(point)-self.anchor)/self.span
        delta*=np.array([-1 if self.mirror else 1,1.35])*self.gain
        target=np.clip(self.origin+delta,0,1)
        error=(target-self.position)*self.size
        if np.linalg.norm(error)<3: return self.position.copy()
        step=(target-self.position)*(1-math.exp(-max(0,min(dt,.1))/.085))
        distance=np.linalg.norm(step*self.size); limit=1800*min(max(dt,0),.06)
        if distance>limit and distance>0: step*=limit/distance
        self.position=np.clip(self.position+step,0,1); return self.position.copy()

class Dwell:
    def __init__(self,seconds=1.2,radius=18):
        self.seconds=seconds; self.radius=radius; self.reset()
    def reset(self,position=None):
        self.anchor=None; self.since=None; self.last_click=np.asarray(position,float) if position is not None else None
        self.progress=0.; self.last_time=None
    def update(self,now,position,valid=True):
        p=np.asarray(position,float)
        if not valid or (self.last_time is not None and now-self.last_time>.25):
            self.anchor=None; self.since=None; self.progress=0.; self.last_time=now; return False
        self.last_time=now
        # Must move away after activation/click: no repeat clicks on a stationary head.
        if self.last_click is not None:
            if np.linalg.norm(p-self.last_click)<45: self.progress=0.; return False
            self.last_click=None; self.anchor=None
        if self.anchor is None or np.linalg.norm(p-self.anchor)>self.radius:
            self.anchor=p.copy(); self.since=now; self.progress=0.; return False
        self.progress=min(1.,(now-self.since)/self.seconds)
        if self.progress>=1:
            self.last_click=p.copy(); self.anchor=None; self.progress=0.; return True
        return False
