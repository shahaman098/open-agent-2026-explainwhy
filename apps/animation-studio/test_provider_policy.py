"""OpenRouter-only app policy cannot fall back to local checkpoint inference."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from models import Catalog,describe_router
from pipeline import Director
from openrouter_backend import MODEL_ID,RouterError

class ProviderPolicyTests(unittest.TestCase):
    def test_cloud_only_catalog_never_discovers_or_describes_local_models(self):
        with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as tmp:
            registry=Path(tmp)/'registry.json'
            registry.write_text(json.dumps({'selected':'old_nemotron_id','paths':['/old/local/model']}))
            with patch('models.describe',side_effect=AssertionError('Local discovery forbidden')),patch('models.studio.models',side_effect=AssertionError('LM Studio discovery forbidden')):
                catalog=Catalog(registry,provider_only='openrouter')
                self.assertEqual(len(catalog.list()),1);self.assertEqual(catalog.selected()['api_model'],MODEL_ID)
                catalog.refresh();catalog.select(catalog.selected()['id'])
            self.assertEqual(Catalog(registry,provider_only='openrouter').selected()['api_model'],MODEL_ID)
            with self.assertRaisesRegex(ValueError,'Local models are disabled'):catalog.add('/any/local/checkpoint')
            with self.assertRaisesRegex(ValueError,'only DeepSeek'):catalog.get('old_nemotron_id')
    def test_worker_rejects_local_and_other_cloud_models_before_loading(self):
        director=Director({},provider_only='openrouter')
        for entry in ({'id':'local','backend':'mlx'},{'id':'studio','backend':'lmstudio'},
                      {'id':'other','backend':'openrouter','api_model':'other/model'}):
            with self.subTest(entry=entry),self.assertRaisesRegex(ValueError,'Only DeepSeek'):director.configure(entry)
        with self.assertRaisesRegex(ValueError,'Only DeepSeek'):director.load()
        self.assertIsNone(director.model)
    def test_missing_api_key_never_falls_back_to_local_inference(self):
        director=Director({},provider_only='openrouter');director.configure(describe_router())
        with patch('pipeline.router.verify_key',side_effect=RouterError('Add API key')):
            with self.assertRaisesRegex(RouterError,'API key'):director.load()
        self.assertIsNone(director.model);self.assertFalse(director.cloud_connected)

if __name__=='__main__':unittest.main()
