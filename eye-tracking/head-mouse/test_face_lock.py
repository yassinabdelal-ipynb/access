import unittest
from face_lock import FaceLock, LOSE_AFTER


def face(x, y, span):
    return {'center': (x, y), 'span': span}


class FaceLockTests(unittest.TestCase):
    def test_nothing_in_view(self):
        lock = FaceLock()
        self.assertIsNone(lock.choose([], 0.))
        self.assertFalse(lock.locked)

    def test_single_head_is_followed_through_normal_movement(self):
        lock = FaceLock()
        x = 320.
        for step in range(120):
            x += 4 * (1 if step < 60 else -1)  # slow side to side motion
            self.assertEqual(lock.choose([face(x, 240, 70)], step / 30.), 0)

    def test_picks_the_nearest_of_several(self):
        lock = FaceLock()
        # Index 1 has the widest eye span, so it is the nearest to the camera.
        self.assertEqual(lock.choose([face(100, 200, 40), face(380, 250, 90), face(560, 220, 55)], 0.), 1)

    def test_a_newcomer_never_takes_over_even_when_nearer(self):
        lock = FaceLock()
        self.assertEqual(lock.choose([face(320, 240, 60)], 0.), 0)
        for step in range(1, 90):
            now = step / 30.
            original = face(320 + step % 5, 240, 60)
            newcomer = face(120, 230, 140)  # much nearer and bigger
            order = [newcomer, original] if step % 2 else [original, newcomer]  # detector order is arbitrary
            chosen = lock.choose(order, now)
            self.assertIs(order[chosen], original, f'followed the wrong head at step {step}')

    def test_a_second_head_near_the_first_does_not_steal(self):
        lock = FaceLock()
        lock.choose([face(320, 240, 60)], 0.)
        original, close = face(322, 240, 60), face(420, 240, 66)
        self.assertEqual(lock.choose([close, original], .033), 1)

    def test_waits_instead_of_jumping_when_the_original_is_briefly_hidden(self):
        lock = FaceLock()
        lock.choose([face(320, 240, 60)], 0.)
        stranger = face(80, 200, 100)
        self.assertIsNone(lock.choose([stranger], 0.5), 'must not follow someone else')
        self.assertIsNone(lock.choose([stranger], 1.0))
        self.assertIsNone(lock.choose([], 1.2))

    def test_original_returning_after_a_short_gap_is_recognised(self):
        lock = FaceLock()
        lock.choose([face(320, 240, 60)], 0.)
        self.assertIsNone(lock.choose([], .5))
        self.assertEqual(lock.choose([face(380, 250, 62)], 1.0), 0)

    def test_after_the_original_is_gone_for_good_the_nearest_is_chosen(self):
        lock = FaceLock()
        lock.choose([face(320, 240, 60)], 0.)
        stranger = face(80, 200, 100)
        self.assertIsNone(lock.choose([stranger], LOSE_AFTER - .2))
        self.assertEqual(lock.choose([stranger], LOSE_AFTER + .3), 0)
        # and now it stays on the new person
        self.assertEqual(lock.choose([face(500, 100, 150), stranger], LOSE_AFTER + .5), 1)

    def test_empty_frames_for_long_enough_reset_the_lock(self):
        lock = FaceLock()
        lock.choose([face(320, 240, 60)], 0.)
        self.assertIsNone(lock.choose([], LOSE_AFTER + 1))
        self.assertFalse(lock.locked)
        self.assertEqual(lock.choose([face(50, 50, 30)], LOSE_AFTER + 1.1), 0)

    def test_leaning_in_is_not_a_new_person(self):
        lock = FaceLock()
        span = 60.
        lock.choose([face(320, 240, span)], 0.)
        for step in range(1, 40):
            span *= 1.02  # slowly lean toward the camera
            self.assertEqual(lock.choose([face(320, 240, span)], step / 30.), 0)

    def test_bad_numbers_are_ignored(self):
        lock = FaceLock()
        self.assertIsNone(lock.choose([face(float('nan'), 1, 50), face(1, 1, 0)], 0.))
        self.assertEqual(lock.choose([face(float('nan'), 1, 50), face(5, 5, 40)], .1), 1)


if __name__ == '__main__':
    unittest.main()
