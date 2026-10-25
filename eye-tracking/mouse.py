"""Windows cursor movement only. Never clicks, types, or changes mouse settings."""
import ctypes
from ctypes import wintypes
import os

class Mouse:
    def __init__(self):
        self.available=os.name=='nt'
        if self.available:
            self.user32=ctypes.windll.user32
            self.width=self.user32.GetSystemMetrics(0);self.height=self.user32.GetSystemMetrics(1)
        else:self.width,self.height=1920,1080

    def position(self):
        if not self.available:return (.5,.5)
        p=wintypes.POINT();self.user32.GetCursorPos(ctypes.byref(p))
        return p.x/max(1,self.width-1),p.y/max(1,self.height-1)

    def move(self,x,y):
        if not self.available:raise RuntimeError('Desktop mouse control is Windows-only.')
        x=max(0,min(1,float(x)));y=max(0,min(1,float(y)))
        if not self.user32.SetCursorPos(round(x*(self.width-1)),round(y*(self.height-1))):raise RuntimeError('Windows refused cursor movement.')

    def down(self,key):return self.available and bool(self.user32.GetAsyncKeyState(key)&0x8000)
