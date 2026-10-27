"""Incomplete reasoning must not poison resumable generation checkpoints."""
import json
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from pipeline import Director,Job

class GenerationTests(unittest.TestCase):
    def test_incomplete_native_answer_is_preserved_but_regenerated(self):
        for old_receipt in (False,True):
            with self.subTest(old_receipt=old_receipt),tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as tmp:
                folder=Path(tmp);job=Job(folder,{'id':'test','stage':'review','events':[]})
                d=Director({});d.entry.update(reasoning_format='think',reasoning=True)
                mx=types.ModuleType('mlx.core');mx.clear_cache=lambda:None
                vlm=types.ModuleType('mlx_vlm');answers=iter(['reasoning without final','analysis</think>{"ok":true}'])
                def generate(*args,**kwargs):
                    yield types.SimpleNamespace(text=next(answers),generation_tokens=5,prompt_tokens=10,generation_tps=20,peak_memory=1)
                vlm.stream_generate=generate
                (folder/'director').mkdir()
                if old_receipt:
                    (folder/'director/03-test.raw.txt').write_text('old unfinished analysis')
                    (folder/'director/03-test.metrics.json').write_text('{}')
                with patch.dict('sys.modules',{'mlx':types.ModuleType('mlx'),'mlx.core':mx,'mlx_vlm':vlm}),patch.object(d,'load'),patch.object(d,'prepare_prompt',return_value='prompt'),patch.object(d,'memory'):
                    with self.assertRaisesRegex(ValueError,'without a final'):d.generate(job,'03-test','system','user',repair=False)
                    self.assertFalse((folder/'director/03-test.metrics.json').exists())
                    self.assertTrue((folder/'director/03-test.incomplete.metrics.json').exists())
                    self.assertEqual(d.generate(job,'03-test','system','user',repair=False),{'ok':True})
                    self.assertTrue(json.loads((folder/'director/03-test.metrics.json').read_text())['complete'])
                    self.assertEqual(job.data['usage']['calls'],2)

if __name__=='__main__':unittest.main()
