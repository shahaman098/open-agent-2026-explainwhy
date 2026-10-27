import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from pipeline import Job,prepare_audio

class AudioTests(unittest.TestCase):
    def test_no_soundtrack_preserves_silent_workflow(self):
        with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as folder:
            job=Job(Path(folder),{'id':'test','settings':{'duration':5}})
            self.assertEqual(prepare_audio(job),[])
    def test_overlong_speech_is_rejected_instead_of_silently_cut(self):
        with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as folder:
            job=Job(Path(folder),{'id':'test','settings':{'duration':5,'narration':'A long script','voice':'Test voice'},'events':[]})
            result=subprocess.CompletedProcess([],0,stdout=json.dumps({'format':{'duration':'30'}}))
            with patch('speech.validate_voice',return_value='Test voice'),patch('pipeline.command'),patch('pipeline.subprocess.run',return_value=result):
                with self.assertRaisesRegex(ValueError,'will not be silently cut'):prepare_audio(job)
    def test_local_speech_uses_file_input_not_shell_interpolation(self):
        with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as folder:
            text='Words including $(command) and `literal`.';job=Job(Path(folder),{'id':'test','settings':{'duration':5,'narration':text,'voice':'Test voice'},'events':[]})
            result=subprocess.CompletedProcess([],0,stdout=json.dumps({'format':{'duration':'2'}}))
            with patch('speech.validate_voice',return_value='Test voice'),patch('pipeline.command') as command,patch('pipeline.subprocess.run',return_value=result):tracks=prepare_audio(job)
            args=command.call_args.args[1];self.assertIn('-f',args);self.assertNotIn(text,args)
            self.assertEqual((Path(folder)/'narration.txt').read_text(),text);self.assertEqual(tracks[0]['role'],'narration')

if __name__=='__main__':unittest.main()
