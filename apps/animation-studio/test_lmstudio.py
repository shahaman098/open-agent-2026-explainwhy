"""Local fake native server: transport, completion boundaries, cancellation and provenance."""
import http.server
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import lmstudio_backend as studio
from models import describe_studio
from pipeline import Director,Job

MODEL={'key':'nvidia/nemotron-3.5-super-vl','type':'llm','format':'gguf','display_name':'Nemotron 3.5 Super VL',
       'size_bytes':76977970974,'architecture':'nemotron_h_moe',
       'capabilities':{'vision':True,'reasoning':{'allowed_options':['off','on'],'default':'on'}},
       'loaded_instances':[{'id':'super-instance'}]}

class NativeHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        body=json.dumps({'models':[MODEL|{'loaded_instances':[{'id':'super-instance'}] if self.server.loaded else []}]}).encode()
        self.send_response(200);self.end_headers();self.wfile.write(body)
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.calls.append((self.path,data))
        if self.path.endswith('/load'):
            self.server.loaded=True;self.send_response(200);self.end_headers();self.wfile.write(b'{"instance_id":"super-instance"}');return
        if self.path.endswith('/unload'):
            self.server.loaded=False;self.send_response(200);self.end_headers();self.wfile.write(b'{}');return
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
        if self.server.mode=='blocked':
            self.server.block.wait(3);return
        events=[{'type':'reasoning.delta','content':'{"private":true}'},
                {'type':'message.delta','content':'{"ok":true}'}]
        if self.server.mode!='incomplete':events.append({'type':'chat.end','result':{
            'output':[{'type':'reasoning','content':'{"private":true}'},{'type':'message','content':'{"ok":true}'}],
            'stats':{'total_output_tokens':20,'input_tokens':10,'reasoning_output_tokens':12,'tokens_per_second':5}}})
        for event in events:
            self.wfile.write(('event: '+event['type']+'\ndata: '+json.dumps(event)+'\n\n').encode());self.wfile.flush()

class StudioTests(unittest.TestCase):
    def setUp(self):
        self.http=http.server.ThreadingHTTPServer(('127.0.0.1',0),NativeHandler);self.http.daemon_threads=True
        self.http.loaded=True;self.http.calls=[];self.http.mode='normal';self.http.block=threading.Event()
        self.worker=threading.Thread(target=self.http.serve_forever,daemon=True);self.worker.start()
        self.port=patch.object(studio,'PORT',self.http.server_port);self.port.start()
        self.tmp=tempfile.TemporaryDirectory(dir=tempfile.gettempdir())
    def tearDown(self):
        self.http.block.set();self.port.stop();self.http.shutdown();self.http.server_close();self.worker.join();self.tmp.cleanup()
    def director(self):
        result=Director({});result.configure(describe_studio(MODEL));return result
    def test_adopts_existing_instance_and_unloads_only_that_instance(self):
        director=self.director();director.load()
        self.assertEqual(director.remote_instance,'super-instance');self.assertEqual(self.http.calls,[])
        self.assertIsNone(director.memory()['active_bytes'])
        director.unload()
        self.assertEqual(self.http.calls,[('/api/v1/models/unload',{'instance_id':'super-instance'})])
        self.assertIsNone(director.remote_instance)
    def test_loads_missing_model_through_native_api(self):
        self.http.loaded=False;director=self.director();director.load()
        path,body=self.http.calls[0];self.assertEqual(path,'/api/v1/models/load')
        self.assertEqual(body['model'],MODEL['key']);self.assertEqual(director.status['model_state'],'ready')
    def test_generation_uses_only_final_output_and_records_real_usage(self):
        director=self.director();job=Job(Path(self.tmp.name),{'id':'test','stage':'planning','events':[]})
        output=director.generate(job,'plan','Return JSON.','Test',max_tokens=100)
        self.assertEqual(output,{'ok':True});self.assertEqual(job.data['usage']['tokens'],20)
        path,body=self.http.calls[-1];self.assertEqual(path,'/api/v1/chat')
        self.assertEqual(body['reasoning'],'on');self.assertFalse(body['store']);self.assertEqual(body['integrations'],[])
        self.assertNotIn('private',(Path(self.tmp.name)/'director/plan.raw.txt').read_text())
    def test_incomplete_stream_is_not_accepted(self):
        self.http.mode='incomplete'
        with self.assertRaisesRegex(studio.StudioError,'before completing'):
            studio.stream_chat({'model':'super-instance','stream':True},threading.Event(),lambda e:None)
    def test_cancel_interrupts_a_blocked_socket(self):
        self.http.mode='blocked';cancel=threading.Event();timer=threading.Timer(.15,cancel.set)
        start=time.monotonic();timer.start()
        with self.assertRaises(studio.StudioCancelled):studio.stream_chat({'model':'super-instance','stream':True},cancel,lambda e:None)
        timer.join();self.assertLess(time.monotonic()-start,2)

if __name__=='__main__':unittest.main()
