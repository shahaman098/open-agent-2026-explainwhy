"""HTTP and process cancellation tests. No model is loaded; production jobs untouched."""
import http.server
import copy
import json
import queue
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
import server
from pipeline import Job,Cancelled,command
from models import Catalog
import openrouter_backend as router

class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='orbit-test-',dir=tempfile.gettempdir())
        self.old_state=copy.deepcopy(server.state);self.old_catalog=server.catalog
        model=Path(self.tmp.name)/'model';model.mkdir()
        (model/'config.json').write_text(json.dumps({'model_type':'qwen3_5','vision_config':{'depth':1},'quantization':{'bits':4}}))
        (model/'model.safetensors').write_bytes(b'fixture, never loaded')
        server.catalog=Catalog(Path(self.tmp.name)/'registry.json',roots=[])
        self.entry=server.catalog.add(str(model));server.catalog.select(self.entry['id'])
        server.state.update(model_operation=None,model_state='cold',loaded_model=None,model_error=None)
        server.selected_status(self.entry)
        server.JOBS=Path(self.tmp.name);server.jobs.clear();server.state['active_job']=None;server.pending=queue.Queue()
        self.http=http.server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
        self.base=f'http://127.0.0.1:{self.http.server_port}'
    def tearDown(self):
        self.http.shutdown();self.http.server_close();self.thread.join();self.tmp.cleanup()
        server.catalog=self.old_catalog;server.state.clear();server.state.update(self.old_state)
    def request(self,path,data=None,headers=None):
        headers=headers or {}
        if data is not None:headers={'Content-Type':'application/json','X-Orbit-Token':server.TOKEN}|headers
        try:r=urlopen(Request(self.base+path,data=json.dumps(data).encode() if data is not None else None,headers=headers),timeout=5)
        except HTTPError as e:r=e
        with r:return r.status,r.read(),r.headers
    def create(self):
        code,body,_=self.request('/api/jobs',{'prompt':'A satellite orbiting Earth','duration':10,'quality':'preview'})
        self.assertEqual(code,202);return json.loads(body)
    def test_create_exclusive_queue_and_cancel(self):
        job=self.create();self.assertEqual(job['status'],'queued')
        code,_,_=self.request('/api/jobs',{'prompt':'Another scene','duration':10});self.assertEqual(code,409)
        code,_,_=self.request(f'/api/jobs/{job["id"]}/cancel',{});self.assertEqual(code,200)
        self.assertTrue(server.jobs[job['id']].cancel.is_set())
    def test_retry_preserves_job_id(self):
        job=self.create();server.jobs[job['id']].update(status='failed');server.state['active_job']=None
        code,body,_=self.request(f'/api/jobs/{job["id"]}/retry',{});self.assertEqual(code,202)
        self.assertEqual(json.loads(body)['id'],job['id']);self.assertEqual(server.state['active_job'],job['id'])
    def test_locked_provider_rejects_resuming_local_generation(self):
        job=self.create();server.jobs[job['id']].update(status='failed');server.state['active_job']=None
        server.catalog=Catalog(Path(self.tmp.name)/'cloud.json',roots=[],provider_only='openrouter')
        server.selected_status(server.catalog.selected())
        code,body,_=self.request(f'/api/jobs/{job["id"]}/retry',{'render_only':False})
        self.assertEqual(code,409);self.assertIn('Local model generation is disabled',json.loads(body)['error'])
        self.assertEqual(server.jobs[job['id']].data['status'],'failed');self.assertIsNone(server.state['active_job'])
    def test_render_only_resume_does_not_call_model(self):
        from test_schema import scene
        from pipeline import run
        root=Path(self.tmp.name);(root/'scene.json').write_text(json.dumps(scene()))
        job=Job(root,{'id':'test','render_only':True,'settings':{'duration':10,'engine':'eevee'},'events':[]})
        class NoModel:
            def load(self,*args):raise AssertionError('Render resume must not reload or call the model')
        with patch('pipeline.finish_render') as final:
            run(job,NoModel());final.assert_called_once()
        self.assertTrue(job.data['render_checkpoint'])
    def test_origin_and_token(self):
        for headers in [{'Origin':'https://example.org'},{'X-Orbit-Token':'wrong'}]:
            code,_,_=self.request('/api/jobs',{'prompt':'An animation'},headers);self.assertEqual(code,403)
    def test_path_traversal(self):
        code,_,_=self.request('/artifacts/%2e%2e/server.py');self.assertEqual(code,403)
    def test_video_ranges(self):
        folder=server.JOBS/'0123456789abcdef';folder.mkdir();(folder/'sample.mp4').write_bytes(b'0123456789')
        code,body,headers=self.request('/artifacts/0123456789abcdef/sample.mp4',headers={'Range':'bytes=2-5'})
        self.assertEqual((code,body),(206,b'2345'));self.assertEqual(headers['Content-Range'],'bytes 2-5/10')
        code,_,_=self.request('/artifacts/0123456789abcdef/sample.mp4',headers={'Range':'bytes=99-100'});self.assertEqual(code,416)
    def test_invalid_values(self):
        for values in [{'duration':True},{'duration':999},{'quality':'unknown'},{'prompt':'x'}]:
            code,_,_=self.request('/api/jobs',{'prompt':'A satellite animation','duration':10}|values);self.assertEqual(code,400)
    def test_expanded_capabilities_and_demo_provenance(self):
        code,body,_=self.request('/api/capabilities');self.assertEqual(code,200);self.assertIn('terrain',json.loads(body)['geometry'])
        code,body,_=self.request('/api/demos/render',{'demo':'mountain-drive','quality':'preview','fps':30})
        self.assertEqual(code,202);job=json.loads(body);self.assertFalse(job['use_model']);self.assertEqual(job['source'],'built_in_demo');self.assertEqual(job['settings']['fps'],30)
        self.assertTrue((server.JOBS/job['id']/'scene-initial.json').exists())
    def test_imported_scene_validation_and_new_version(self):
        from test_v2 import scene
        code,body,_=self.request('/api/scene/validate',{'scene':scene(),'duration':5});self.assertEqual(code,200);self.assertTrue(json.loads(body)['valid'])
        code,body,_=self.request('/api/jobs/from-scene',{'scene':scene(),'duration':5,'parent_job':'0123456789abcdef'})
        self.assertEqual(code,202);job=json.loads(body);self.assertEqual(job['parent_job'],'0123456789abcdef');self.assertFalse(job['use_model'])
    def test_invalid_import_creates_no_job(self):
        code,_,_=self.request('/api/jobs/from-scene',{'scene':{'version':2},'duration':5});self.assertEqual(code,400);self.assertIsNone(server.state['active_job'])
        code,_,_=self.request('/api/demos/render',{'demo':'unknown'});self.assertEqual(code,400)
    def test_refine_preserves_original_and_pins_selected_model(self):
        from test_v2 import scene
        original=self.create();parent=server.jobs[original['id']]
        parent.update(status='complete',plan={'title':'Original','shots':[]});server.state['active_job']=None
        source=scene();source['shots'][0]['end']=original['settings']['duration']
        path=parent.folder/'scene.json';path.write_text(json.dumps(source));before=path.read_bytes()
        code,body,_=self.request(f'/api/jobs/{parent.data["id"]}/refine',{'instruction':'Make the whole model visible','reviews':1})
        self.assertEqual(code,202);child=json.loads(body)
        self.assertNotEqual(child['id'],parent.data['id']);self.assertEqual(child['parent_job'],parent.data['id'])
        self.assertEqual(child['source'],'model_refinement');self.assertTrue(child['use_saved_plan']);self.assertEqual(child['model']['id'],self.entry['id'])
        self.assertEqual(child['settings']['duration'],original['settings']['duration']);self.assertEqual(child['settings']['reviews'],1)
        self.assertEqual(path.read_bytes(),before);self.assertEqual(parent.data['status'],'complete')
    def test_refine_requires_completed_scene_and_bounded_instruction(self):
        original=self.create();server.state['active_job']=None;endpoint=f'/api/jobs/{original["id"]}/refine'
        for data in ({'instruction':'x'},{'instruction':'Fix the camera','reviews':True}):
            code,_,_=self.request(endpoint,data);self.assertEqual(code,400)
        code,_,_=self.request(endpoint,{'instruction':'Fix the camera'});self.assertEqual(code,409)
    def test_binary_image_upload_is_local_and_reference_ids_are_validated(self):
        import io
        from PIL import Image
        stream=io.BytesIO();Image.new('RGB',(8,8),'blue').save(stream,format='PNG')
        with patch.object(server.asset_library,'ROOT',Path(self.tmp.name)/'library'):
            req=Request(self.base+'/api/library/image',data=stream.getvalue(),headers={'Content-Type':'image/png','X-Orbit-Token':server.TOKEN,'X-Asset-Name':'Test%20image.png'},method='POST')
            with urlopen(req,timeout=5) as response:item=json.load(response)
            self.assertEqual(item['name'],'Test image.png');self.assertEqual(item['kind'],'image')
            code,body,_=self.request('/api/library');self.assertEqual(code,200);self.assertEqual(len(json.loads(body)),1)
            code,body,_=self.request('/api/jobs',{'prompt':'A product animation','references':[item['id']]});self.assertEqual(code,202)
            self.assertEqual(json.loads(body)['references'],[item['id']])
    def test_model_control_is_exclusive_and_pins_job(self):
        code,body,_=self.request('/api/models/load',{'model_id':self.entry['id']});self.assertEqual(code,202)
        self.assertEqual(json.loads(body)['model_operation']['action'],'load')
        for path,data in [('/api/models/unload',{}),('/api/models/select',{'model_id':self.entry['id']}),('/api/jobs',{'prompt':'A moving model'})]:
            code,_,_=self.request(path,data);self.assertEqual(code,409)
        server.model_task(server.pending.get_nowait(),self.FakeDirector())
        self.assertIsNone(server.state['model_operation'])
        self.assertEqual(server.state['loaded_model'],self.entry['id'])
        job=self.create();self.assertEqual(job['model']['id'],self.entry['id'])
        code,_,_=self.request('/api/models/unload',{});self.assertEqual(code,409)
    def test_model_failure_releases_reservation_and_allows_retry(self):
        code,_,_=self.request('/api/models/load',{'model_id':self.entry['id']});self.assertEqual(code,202)
        class Failing(self.FakeDirector):
            def load(self):raise RuntimeError('Load failed')
        server.model_task(server.pending.get_nowait(),Failing())
        self.assertIsNone(server.state['model_operation']);self.assertEqual(server.state['model_state'],'error')
        self.assertEqual(server.state['model_error'],'Load failed');self.assertIsNone(server.state['loaded_model'])
        code,_,_=self.request('/api/models/load',{'model_id':self.entry['id']});self.assertEqual(code,202)
    def test_unload_preserves_selected_checkpoint(self):
        server.state.update(loaded_model=self.entry['id'],model_state='ready')
        code,_,_=self.request('/api/models/unload',{});self.assertEqual(code,202)
        server.model_task(server.pending.get_nowait(),self.FakeDirector())
        self.assertIsNone(server.state['loaded_model']);self.assertEqual(server.state['selected_model'],self.entry['id'])
    def test_model_endpoints_require_same_origin_token(self):
        code,_,_=self.request('/api/models/unload',{},headers={'X-Orbit-Token':'wrong'});self.assertEqual(code,403)
        code,_,_=self.request('/api/models/load',{'model_id':'not-local'});self.assertEqual(code,400)
    def test_api_key_is_session_only_never_returned_and_can_be_cleared(self):
        before=router._override;fake=('sk-or-' + 'test-only-not-a-real-credential-' * 2)
        try:
            code,_,_=self.request('/api/openrouter/key',{'api_key':fake},headers={'X-Orbit-Token':'wrong'});self.assertEqual(code,403)
            code,body,_=self.request('/api/openrouter/key',{'api_key':fake});self.assertEqual(code,200)
            self.assertNotIn(fake,body.decode());self.assertTrue(json.loads(body)['configured'])
            code,status,_=self.request('/api/status');self.assertNotIn(fake,status.decode())
            self.assertTrue(json.loads(status)['openrouter']['configured'])
            code,body,_=self.request('/api/openrouter/key',{'clear':True});self.assertEqual(code,200)
            self.assertFalse(json.loads(body)['configured'])
            self.assertFalse(any(fake in p.read_text() for p in Path(self.tmp.name).rglob('*.json')))
        finally:router._override=before
    class FakeDirector:
        def configure(self,entry):self.entry=entry
        def load(self):server.state.update(model_state='ready',loaded_model=self.entry['id'])
        def unload(self):server.state.update(model_state='cold',loaded_model=None)
    def test_cancellation_terminates_owned_process(self):
        j=Job(Path(self.tmp.name),{'id':'test','events':[]});start=time.monotonic()
        timer=threading.Timer(.2,j.cancel.set);timer.start()
        with self.assertRaises(Cancelled):
            command(j,[sys.executable,'-u','-c','import time; print("ready", flush=True); time.sleep(30)'],Path(self.tmp.name)/'cancel.log')
        timer.join();self.assertLess(time.monotonic()-start,8)

if __name__=='__main__':unittest.main()
