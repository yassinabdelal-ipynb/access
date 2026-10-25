import unittest
from tempfile import TemporaryDirectory
from pathlib import Path
from head_settings import save, load, DEFAULTS

class SettingsTests(unittest.TestCase):
    def test_round_trip_preserves_confirmed_settings_without_enabling_mouse(self):
        with TemporaryDirectory() as d:
            path=Path(d)/'settings.json'
            saved=save({**DEFAULTS, 'gain':1.25, 'enabled':True},path)
            self.assertEqual(load(path),saved)
            self.assertEqual(saved['closed_threshold'],0.4566502463054187)
            self.assertEqual(saved['open_threshold'],0.4517241379310345)
            self.assertNotIn('enabled',saved)
    def test_invalid_update_keeps_last_good_file(self):
        with TemporaryDirectory() as d:
            path=Path(d)/'settings.json';save(DEFAULTS,path)
            with self.assertRaises(ValueError):save({**DEFAULTS,'open_threshold':.5},path)
            self.assertEqual(load(path),DEFAULTS)
            path.write_text('{broken')
            self.assertEqual(load(path),DEFAULTS)

if __name__=='__main__':unittest.main()
