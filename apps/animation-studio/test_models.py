"""Checkpoint validation and reasoning separation, with no model imports or weight loading."""
import json
import tempfile
import unittest
import os
from pathlib import Path
from models import Catalog, describe
from pipeline import Director


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=tempfile.gettempdir())
        self.root=Path(self.tmp.name).resolve()
    def tearDown(self):self.tmp.cleanup()
    def checkpoint(self,name='model',**config):
        p=self.root/name;p.mkdir()
        (p/'config.json').write_text(json.dumps({'model_type':'qwen3_5','vision_config':{'layers':1}}|config))
        (p/'model.safetensors').write_bytes(b'not loaded')
        return p
    def test_missing_shard_and_unsafe_model_file_not_loadable(self):
        p=self.checkpoint(model_file='unexpected.py')
        (p/'unexpected.py').write_text('raise RuntimeError("must not execute")')
        self.assertFalse(describe(p)['supported'])
        p=self.checkpoint('incomplete')
        (p/'model.safetensors.index.json').write_text(json.dumps({'weight_map':{'weights':'missing.safetensors'}}))
        self.assertFalse(describe(p)['supported'])
    def test_custom_transformers_code_not_implicitly_enabled(self):
        p=self.checkpoint(auto_map={'AutoProcessor':'local.Custom'})
        self.assertFalse(describe(p)['supported'])
    def test_catalog_selection_and_paths_survive_restart(self):
        p=self.checkpoint();registry=self.root/'registry.json'
        catalog=Catalog(registry,roots=[]);entry=catalog.add(str(p));catalog.select(entry['id'])
        again=Catalog(registry,roots=[])
        self.assertEqual(again.selected()['path'],str(p));self.assertTrue(again.selected()['vision'])
        with self.assertRaises(ValueError):again.add('relative/model')
    def test_text_model_capability(self):
        entry=describe(self.checkpoint(model_type='gpt_oss',vision_config=None))
        self.assertFalse(entry['vision']);self.assertEqual(entry['reasoning_format'],'harmony')
    def test_reasoning_json_is_never_treated_as_final_output(self):
        director=Director({})
        director.entry['reasoning_format']='harmony'
        raw='<|channel|>analysis<|message|>{"private":true}<|end|><|start|>assistant<|channel|>final<|message|>{"answer":true}<|return|>'
        self.assertEqual(json.loads(director.public_answer(raw)),{'answer':True})
        with self.assertRaises(ValueError):director.public_answer(raw.split('<|channel|>final')[0])
        director.entry['reasoning_format']='think'
        self.assertEqual(json.loads(director.public_answer('{"private":true}</think>{"answer":true}')),{'answer':True})
    @unittest.skipUnless(bool(os.environ.get('ORBIT_TEST_MODEL')),'Local Qwen checkpoint unavailable')
    def test_actual_qwen_template_accepts_generation_settings(self):
        from transformers import AutoTokenizer
        from jinja2.exceptions import TemplateError
        tokenizer=AutoTokenizer.from_pretrained(os.environ['ORBIT_TEST_MODEL'],trust_remote_code=False,local_files_only=True)
        messages=[{'role':'user','content':'Return a JSON object.'}]
        with self.assertRaisesRegex(TemplateError,'Unexpected reasoning effort high'):
            tokenizer.apply_chat_template(messages,tokenize=False,enable_thinking=True,reasoning_effort='high')
        director=Director({});director.entry.update(reasoning=True,reasoning_format='think')
        prompt=tokenizer.apply_chat_template(messages,tokenize=False,add_generation_prompt=True,**director.template_options())
        self.assertIn('Reasoning effort is set to xhigh',prompt)
        self.assertIn('Return a JSON object.',prompt)


if __name__=='__main__':unittest.main()
