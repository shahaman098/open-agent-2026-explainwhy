"""Reviews cannot throw away a usable scene or turn a cancellation into a render."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from pipeline import Job,Cancelled,review_scene,run
from schema import validate
from test_schema import scene

class FakeDirector:
    entry={'vision':True}
    def __init__(self,result=None,error=None):self.result=result;self.error=error;self.calls=[]
    def generate(self,job,name,system,user,**kwargs):
        self.calls.append((name,system,kwargs))
        if self.error:raise self.error
        if '-critique' in name and isinstance(self.result,dict):return {k:v for k,v in self.result.items() if k!='patches'}
        return copy.deepcopy(self.result)

class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=tempfile.gettempdir());self.folder=Path(self.tmp.name)
        self.preview=self.folder/'preview-0';self.preview.mkdir()
        self.job=Job(self.folder,{'id':'test','prompt':'A satellite turns slowly','events':[]})
        self.scene=validate(scene(),10)
    def tearDown(self):self.tmp.cleanup()
    def review(self,director):return review_scene(self.job,director,self.scene,self.preview,{},10,0)
    def test_small_valid_patch_preserves_geometry(self):
        director=FakeDirector({'assessment':'Improve metal contrast.','issues':['Too pale.'],'patches':[{'op':'replace','path':'/materials/0/color','value':'#123456'}]})
        before=copy.deepcopy(self.scene);updated,record=self.review(director)
        self.assertEqual(self.scene,before);self.assertEqual(updated['assets'],before['assets'])
        self.assertEqual(updated['materials'][0]['color'],'#123456');self.assertEqual(record['status'],'complete')
        name,system,options=director.calls[0];self.assertEqual(name,'03-review-1-critique');self.assertFalse(options['repair'])
        self.assertNotIn('SCENE LANGUAGE',system);self.assertIn('FOUR',system)
        self.assertEqual(director.calls[1][0],'03-review-1-edit-v2');self.assertIn('MINIMAL JSON Patch',director.calls[1][1])
    def test_length_or_network_failure_preserves_scene_with_warning(self):
        from openrouter_backend import RouterError
        for error in (ValueError('response length'),RouterError('network unavailable')):
            with self.subTest(error=error):
                updated,record=self.review(FakeDirector(error=error))
                self.assertEqual(updated,self.scene);self.assertEqual(record['status'],'unavailable')
                self.assertIn('visual issues may remain',self.job.data['warnings'][-1])
    def test_invalid_patch_or_full_array_replacement_is_rejected(self):
        for patches in ([{'op':'replace','path':'/instances/0/asset','value':'missing'}],
                        [{'op':'replace','path':'/assets','value':[]}],
                        [{'op':'remove','path':'/../../file'}]):
            updated,record=self.review(FakeDirector({'assessment':'Fix it','issues':['Fix the subject'],'patches':patches}))
            self.assertEqual(updated,self.scene);self.assertEqual(record['status'],'unavailable')
    def test_repetitive_criticism_is_bounded_and_deduplicated(self):
        director=FakeDirector({'assessment':'Too pale.','issues':['Too pale.']*200+['Too dark.'],'patches':[]})
        updated,record=self.review(director)
        self.assertEqual(record['issues'],['Too pale.','Too dark.']);self.assertEqual(record['status'],'complete');self.assertEqual(updated,self.scene)
    def test_no_issues_skips_editor(self):
        director=FakeDirector({'assessment':'Looks consistent','issues':[]})
        self.review(director);self.assertEqual(len(director.calls),1)
    def test_invalid_edit_receives_one_targeted_correction(self):
        class Correcting(FakeDirector):
            def generate(self,job,name,*args,**kwargs):
                if '-critique' in name:return {'assessment':'Too pale','issues':['Darken metal']}
                if name.endswith('-patch-2'):return {'patches':[{'op':'replace','path':'/materials/0/color','value':'#123456'}]}
                return {'patches':[{'op':'replace','path':'/materials/missing/color','value':'#123456'}]}
        updated,record=self.review(Correcting());self.assertEqual(record['status'],'complete');self.assertEqual(updated['materials'][0]['color'],'#123456')
    def test_review_rebuilds_only_requested_asset(self):
        from test_v2 import scene as v2_scene
        from pipeline import edit_review
        source=v2_scene();desk=copy.deepcopy(source['assets'][0]);desk.update(id='desk',name='Desk')
        source['assets'].append(desk);source['instances'].append({'id':'desk_instance','asset':'desk'})
        source=validate(source,5);before=copy.deepcopy(source)
        rebuilt=copy.deepcopy(desk);rebuilt['parts'][0]['size']=[4,3,.1]
        director=FakeDirector({'patches':[],'rebuild_assets':[{'id':'desk','instruction':'A flat desk surface, no lamp'}]})
        with patch('pipeline.build_one_asset',return_value=(rebuilt,source['materials'])) as build:
            updated=edit_review(self.job,director,source,{'issues':['Wrong desk']},source['assets'],5,0)
        build.assert_called_once();self.assertEqual(build.call_args.args[2]['id'],'desk')
        self.assertEqual(updated['assets'][0],before['assets'][0]);self.assertEqual(updated['assets'][1]['parts'][0]['size'],[4,3,.1]);self.assertEqual(source,before)
    def test_only_known_single_scene_wrapper_is_normalized(self):
        from pipeline import canonical_review_patches
        values=[{'op':'replace','path':'/scenes/0/materials/0/color','value':'#123456'},{'op':'remove','path':'/scenes/1/assets'},{'op':'remove','path':'/scene/files'}]
        patches,aliases=canonical_review_patches(values)
        self.assertEqual(patches[0]['path'],'/materials/0/color');self.assertEqual(len(aliases),1)
        self.assertEqual(patches[1:],values[1:]);self.assertEqual(values[0]['path'],'/scenes/0/materials/0/color')
    def test_cancellation_never_becomes_a_warning(self):
        self.job.cancel.set()
        with self.assertRaises(Cancelled):self.review(FakeDirector(error=ValueError('cancelled')))
        with self.assertRaises(Cancelled):self.review(FakeDirector(error=Cancelled('stop')))
    def test_failed_review_still_reaches_final_render(self):
        s=scene();s['shots'][0]['camera']={'focus':'hero'}
        class RunDirector(FakeDirector):
            def load(self,job):pass
            def generate(self,job,name,*args,**kwargs):
                if name=='01-plan':return {'title':'Test','shots':[]}
                if name=='02-scene-1':return copy.deepcopy(s)
                raise ValueError('review response exhausted its token budget')
        self.job.data['settings']={'duration':10,'width':1280,'samples':32,'reviews':2,'quality':'preview','fps':24,'engine':'eevee'}
        def fake_blender(job,mode,path,out,handler=None):
            out.mkdir(exist_ok=True);(out/'inspection.json').write_text('{}')
            for i,frame in enumerate((1,60,120,180,240)):handler({'preview':i,'frame':frame,'file':f'preview-{i}.png'})
        with patch('pipeline.render_assets'),patch('pipeline.blender',side_effect=fake_blender),patch('pipeline.contact_sheet'),patch('pipeline.finish_render') as finish:
            run(self.job,RunDirector())
        finish.assert_called_once();self.assertTrue(self.job.data['render_checkpoint'])
        self.assertEqual(self.job.data['reviews'][0]['status'],'unavailable')
        self.assertEqual(finish.call_args.args[1],validate(s,10))

if __name__=='__main__':unittest.main()
