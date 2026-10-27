"""Cloud transport tests use a loopback fixture and a non-secret fake API key."""
import http.client
import http.server
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import openrouter_backend as router
from models import describe_router
from pipeline import Director,Job

FAKE_KEY=('sk-or-' + 'test-only-not-a-real-credential-' * 2)
class RouterHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        self.send_response(200);self.end_headers();self.wfile.write(b'{"data":{}}')
    def do_POST(self):
        self.server.payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.server.mode=='http_error':
            self.send_response(401);self.end_headers();self.wfile.write(FAKE_KEY.encode());return
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
        if self.server.mode=='blocked':self.server.block.wait(3);return
        result={'model':router.MODEL_ID,'choices':[{'delta':{'content':'{"ok":true}','reasoning':'PRIVATE'},'finish_reason':'length' if self.server.mode=='length' else 'stop'}]}
        self.wfile.write(('data: '+json.dumps(result)+'\n\n').encode())
        self.wfile.write(b'data: {"usage":{"prompt_tokens":10,"completion_tokens":8,"cost":0.0002}}\n\n')
        if self.server.mode!='incomplete':self.wfile.write(b'data: [DONE]\n\n')
        self.wfile.flush()

class RouterTests(unittest.TestCase):
    def setUp(self):
        self.old_key=router._override;router.set_key(FAKE_KEY)
        self.http=http.server.ThreadingHTTPServer(('127.0.0.1',0),RouterHandler);self.http.daemon_threads=True
        self.http.mode='normal';self.http.block=threading.Event();self.http.payload=None
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
        self.connection=patch.object(router,'connection',lambda timeout=30:http.client.HTTPConnection('127.0.0.1',self.http.server_port,timeout=timeout));self.connection.start()
        self.tmp=tempfile.TemporaryDirectory(dir=tempfile.gettempdir())
    def tearDown(self):
        self.http.block.set();self.connection.stop();self.http.shutdown();self.http.server_close();self.thread.join();self.tmp.cleanup();router._override=self.old_key
    def generate(self):
        director=Director({});director.configure(describe_router())
        job=Job(Path(self.tmp.name),{'id':'test','stage':'planning','events':[]})
        return director.generate(job,'test','Return JSON.','A test animation',max_tokens=100),job
    def test_exact_model_json_mode_usage_and_key_privacy(self):
        result,job=self.generate();self.assertEqual(result,{'ok':True})
        payload=self.http.payload;self.assertEqual(payload['model'],router.MODEL_ID)
        self.assertEqual(payload['response_format'],{'type':'json_object'});self.assertEqual(payload['reasoning']['effort'],'low')
        self.assertEqual(job.data['usage']['cost_usd'],.0002);self.assertEqual(job.data['usage']['tokens'],8)
        self.assertNotIn(FAKE_KEY,json.dumps(router.key_status()))
        for file in Path(self.tmp.name).rglob('*'):
            if file.is_file():self.assertNotIn(FAKE_KEY,file.read_text())
        self.assertNotIn('PRIVATE',(Path(self.tmp.name)/'director/test.raw.txt').read_text())
    def test_truncation_is_not_cached_as_a_complete_answer(self):
        self.http.mode='length'
        with self.assertRaisesRegex(ValueError,'did not finish'):self.generate()
        self.assertFalse((Path(self.tmp.name)/'director/test.metrics.json').exists())
        receipt=json.loads((Path(self.tmp.name)/'director/test.incomplete.metrics.json').read_text())
        self.assertFalse(receipt['complete']);self.assertEqual(receipt['cost_usd'],.0002)
        # A truncated receipt must not make a subsequent request reuse its raw JSON.
        self.http.mode='normal';result,job=self.generate()
        self.assertEqual(result,{'ok':True});self.assertTrue(json.loads((Path(self.tmp.name)/'director/test.metrics.json').read_text())['complete'])
    def test_incomplete_stream_and_redacted_http_error(self):
        self.http.mode='incomplete'
        with self.assertRaisesRegex(router.RouterError,'before completing'):router.stream_chat({},threading.Event(),lambda e:None)
        self.http.mode='http_error'
        with self.assertRaises(router.RouterError) as error:router.stream_chat({},threading.Event(),lambda e:None)
        self.assertNotIn(FAKE_KEY,str(error.exception));self.assertIn('[redacted]',str(error.exception))
    def test_cancel_interrupts_a_blocked_request(self):
        self.http.mode='blocked';cancel=threading.Event();timer=threading.Timer(.15,cancel.set);start=time.monotonic();timer.start()
        with self.assertRaises(router.RouterCancelled):router.stream_chat({},cancel,lambda e:None)
        timer.join();self.assertLess(time.monotonic()-start,2)
    def test_key_is_required(self):
        router.clear_key()
        with self.assertRaisesRegex(router.RouterError,'API key'):self.generate()

if __name__=='__main__':unittest.main()
