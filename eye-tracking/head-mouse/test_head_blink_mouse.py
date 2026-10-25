import unittest
import numpy as np
from head_blink_mouse import WinkHold,eye_state

def arm(w,start=0.):
    for t in np.arange(start,start+.7,.05):w.step(float(t),'open',(.4,.6))

class Tests(unittest.TestCase):
    def test_three_seconds_exactly_once_anchored_before_wink(self):
        w=WinkHold();arm(w)
        w.step(.8,'right',(.4,.6))
        for t in np.arange(.9,3.8,.1):self.assertIsNone(w.step(float(t),'right',(.9,.9)))
        self.assertEqual(w.step(3.81,'right',None),(.4,.6))
        for t in np.arange(3.9,5,.1):self.assertIsNone(w.step(float(t),'right',None))
        self.assertTrue(w.frozen)
        arm(w,5.1)
        self.assertTrue(w.armed)
        self.assertFalse(w.frozen)

    def test_wrong_eye_both_eyes_and_short_blink_cancel(self):
        for state in ('left','both','invalid','open'):
            w=WinkHold();arm(w);w.step(.8,'right',(.4,.6));w.step(.9,state,None)
            for t in np.arange(1.,4.5,.1):self.assertIsNone(w.step(float(t),'right',(.4,.6)))

    def test_missing_and_duplicate_samples_cannot_complete_wink(self):
        w=WinkHold();arm(w);w.step(.8,'right',(.4,.6))
        for _ in range(100):self.assertIsNone(w.step(.8,'right',(.4,.6)))
        self.assertEqual(w.frames,1)
        self.assertIsNone(w.step(4.,'right',(.4,.6)))
        self.assertFalse(w.frozen)

    def test_eye_side_and_hysteresis(self):
        self.assertEqual(eye_state(.1,.8),'right')
        self.assertEqual(eye_state(.8,.1),'left')
        self.assertEqual(eye_state(.8,.8),'both')
        self.assertEqual(eye_state(.1,.1),'open')
        self.assertEqual(eye_state(.1,.58,holding=True),'right')
        self.assertEqual(eye_state(.1,.58),'uncertain')
        self.assertEqual(eye_state(float('nan'),.8),'invalid')
        self.assertEqual(eye_state(.1,.8,closed=.4,opened=.5),'invalid')

    def test_no_anchor_or_no_open_baseline_cannot_click(self):
        w=WinkHold()
        for t in np.arange(0,5,.1):self.assertIsNone(w.step(float(t),'right',(.4,.6)))
        arm(w,6.)
        for t in np.arange(6.8,11,.1):self.assertIsNone(w.step(float(t),'right',None))

    def test_gradual_eyelid_closure_does_not_disarm(self):
        w=WinkHold();arm(w)
        self.assertIsNone(w.step(.70,'uncertain',(.4,.6)))
        self.assertIsNone(w.step(.75,'uncertain',(.4,.6)))
        self.assertIsNone(w.step(.80,'right',(.4,.6)))
        self.assertTrue(w.frozen)
        clicks=[]
        for t in np.arange(.85,4.05,.05):
            result=w.step(float(t),'right',None)
            if result is not None:clicks.append(result)
        self.assertEqual(clicks,[(.4,.6)])

    def test_uncertain_frames_do_not_count_toward_hold(self):
        w=WinkHold();arm(w);w.step(.8,'right',(.4,.6))
        for t in np.arange(.9,2.01,.1):w.step(float(t),'right',None)
        before=w.confirmed
        w.step(2.05,'uncertain',None);w.step(2.10,'uncertain',None)
        w.step(2.15,'right',None)
        self.assertAlmostEqual(w.confirmed,before)
        self.assertTrue(w.frozen)
        for t in np.arange(2.25,3.86,.1):self.assertIsNone(w.step(float(t),'right',None))
        self.assertEqual(w.step(3.96,'right',None),(.4,.6))

    def test_time_before_anchor_is_latched_does_not_count(self):
        w=WinkHold();arm(w);w.step(.8,'right',None);w.step(.9,'right',(.4,.6))
        self.assertEqual(w.confirmed,0.)

    def test_prolonged_uncertainty_and_bilateral_transition_cancel(self):
        for terminal in ('both','left','invalid'):
            w=WinkHold();arm(w);w.step(.70,'uncertain',(.4,.6));w.step(.75,terminal,None)
            self.assertFalse(w.armed)
            self.assertIsNone(w.step(.8,'right',(.4,.6)))
            self.assertFalse(w.frozen)
        w=WinkHold();arm(w);w.step(.7,'uncertain',(.4,.6));w.step(1.,'uncertain',None)
        self.assertFalse(w.armed)

if __name__=='__main__':unittest.main()
