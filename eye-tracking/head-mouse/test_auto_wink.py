import unittest
from types import SimpleNamespace
from collections import deque
from head_blink_mouse import App, WinkHold, eye_state
from head_settings import DEFAULTS

class Status:
    def __init__(self):self.value=''
    def set(self,v):self.value=v
    def get(self):return self.value

class AutomaticControlTests(unittest.TestCase):
    def app(self):
        a=App.__new__(App)
        a.args=SimpleNamespace(bridge=True,smoke_seconds=0)
        a.auto_requested=True;a.enabled=False;a.lease_until=20
        a.history=deque({'timestamp':10+i*.1} for i in range(6))
        a.status=Status();a.events=[];a.emit=lambda kind,**kw:a.events.append(kind)
        a.recenter=lambda:True;a.reset_wink=lambda:None
        return a
    def test_face_return_resumes_but_explicit_pause_does_not(self):
        a=self.app();self.assertTrue(a.maybe_start(10.55))
        a.pause('Lost face',transient=True)
        self.assertTrue(a.auto_requested);self.assertFalse(a.enabled)
        a.history.clear();self.assertFalse(a.maybe_start(10.6))
        a.history.extend({'timestamp':11+i*.1} for i in range(6))
        self.assertTrue(a.maybe_start(11.55))
        a.pause('Manual / Esc');self.assertFalse(a.auto_requested)
        self.assertFalse(a.maybe_start(11.56))
    def test_no_start_with_stale_face_expired_lease_or_smoke(self):
        a=self.app();self.assertFalse(a.maybe_start(12))
        a=self.app();a.lease_until=10;self.assertFalse(a.maybe_start(10.55))
        a=self.app();a.args.smoke_seconds=10;self.assertFalse(a.maybe_start(10.55))
        a=self.app();a.history=deque([{'timestamp':10.5}]*20);self.assertFalse(a.maybe_start(10.55))

class PersonalWinkRegressionTests(unittest.TestCase):
    def state(self,l,r,holding):
        return eye_state(l,r,DEFAULTS['closed_threshold'],DEFAULTS['open_threshold'],holding)
    def test_saved_thresholds_no_longer_raise_hold_threshold(self):
        self.assertEqual(self.state(.2,.49,False),'right')
        self.assertEqual(self.state(.2,.49,True),'right')
        w=WinkHold()
        for i in range(8):w.step(i*.1,'open',(.4,.5))
        clicks=[]
        for i in range(40):
            t=.8+i*.1
            state=self.state(.2,[.49,.47,.44,.50][i%4],w.frozen)
            result=w.step(t,state,(.4,.5))
            if result:clicks.append(result)
        self.assertEqual(clicks,[(.4,.5)])
    def test_bilateral_and_wrong_eye_still_cancel(self):
        for holding in (False,True):
            self.assertEqual(self.state(.8,.8,holding),'both')
            self.assertEqual(self.state(.8,.1,holding),'left')
            self.assertEqual(self.state(.1,.1,holding),'open')
    def test_two_tenths_uncertainty_preserves_but_does_not_add_time(self):
        w=WinkHold()
        for i in range(8):w.step(i*.1,'open',(.4,.5))
        w.step(.8,'right',(.4,.5));w.step(.9,'right',None)
        before=w.confirmed
        for t in (1.,1.1,1.2):w.step(t,'uncertain',None)
        w.step(1.23,'right',None)
        self.assertTrue(w.frozen);self.assertAlmostEqual(w.confirmed,before)

if __name__=='__main__':unittest.main()
