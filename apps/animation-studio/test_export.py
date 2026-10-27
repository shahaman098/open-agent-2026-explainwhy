"""Publication checks use constructed fixtures, never real credentials."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts import check_export

class ExportTests(unittest.TestCase):
    def test_key_findings_do_not_echo_credential_values(self):
        with tempfile.TemporaryDirectory() as folder:
            fake = 'sk-or-' + 'x' * 48
            Path(folder, 'example.py').write_text('key = ' + repr(fake))
            with patch.object(check_export, 'ROOT', Path(folder)):
                findings = check_export.scan(['example.py'])
            self.assertEqual(findings[0]['type'], 'OpenRouter token')
            self.assertNotIn(fake, json.dumps(findings))
    def test_runtime_and_environment_files_cannot_be_exported(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(check_export, 'ROOT', Path(folder)):
                findings = check_export.scan(['.env.local', 'jobs/run/job.json', 'models/weights.gguf'])
            self.assertEqual(len(findings), 3)
    def test_environment_lookup_is_source_code_not_an_embedded_key(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, 'example.py').write_text("key = os.environ.get('OPENROUTER_API_KEY', '')")
            with patch.object(check_export, 'ROOT', Path(folder)):
                self.assertEqual(check_export.scan(['example.py']), [])

if __name__ == '__main__':
    unittest.main()
