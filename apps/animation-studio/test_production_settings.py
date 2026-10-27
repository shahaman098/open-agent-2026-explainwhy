import unittest
from production_settings import settings

class SettingsTests(unittest.TestCase):
    def test_portrait_4k_and_60fps(self):
        s=settings({'duration':120,'quality':'ultra','aspect':'9:16','fps':60,'reviews':5})
        self.assertEqual((s['width'],s['height'],s['fps']),(2160,3840,60));self.assertEqual(s['duration'],120)
    def test_square_and_review_off(self):
        s=settings({'quality':'preview','aspect':'1:1','reviews':0});self.assertEqual(s['width'],s['height']);self.assertEqual(s['reviews'],0)
    def test_bad_settings_fail_before_production(self):
        for data in ({'duration':True},{'fps':25},{'reviews':6},{'engine':'anything'},{'aspect':'1000:1'},{'quality':'8k'},{'detail':'script'}):
            with self.subTest(data=data),self.assertRaises(ValueError):settings(data)
    def test_narration_requires_an_installed_voice_and_bounded_rate(self):
        from unittest.mock import patch
        with patch('speech.voices',return_value=[{'id':'Test voice','locale':'en_GB'}]):
            self.assertEqual(settings({'narration':'Hello','voice':'Test voice'})['voice'],'Test voice')
            with self.assertRaises(ValueError):settings({'narration':'Hello','voice':'invalid; command'})
        with self.assertRaises(ValueError):settings({'speech_rate':999})

if __name__=='__main__':unittest.main()
