"""A bad camera value must not regenerate all geometry."""
import copy
import tempfile
import unittest
from pathlib import Path
from pipeline import Job,create_scene
from schema import apply_scene_patch,validate
from test_schema import scene

class SceneRepairTests(unittest.TestCase):
    def test_patch_preserves_other_data_and_original_input(self):
        original=scene();before=copy.deepcopy(original)
        changed=apply_scene_patch(original,[{'op':'replace','path':'/shots/0/label','value':'Fixed shot'}])
        self.assertEqual(original,before);self.assertEqual(changed['assets'],original['assets'])
        self.assertEqual(changed['shots'][0]['label'],'Fixed shot')
    def test_invalid_paths_and_operations_are_rejected(self):
        for patch in [{'op':'replace','path':'/../../file','value':1},{'op':'move','path':'/assets/0'},{'op':'replace','path':'/assets/999/name','value':'x'}]:
            with self.assertRaises(ValueError):apply_scene_patch(scene(),[patch])
    def test_camera_error_requests_one_short_patch_not_another_scene(self):
        original=scene();original['shots'][0]['camera']={'focus':'hero','margin':10}
        class FakeDirector:
            def __init__(self):self.calls=[]
            def generate(self,job,name,system,user,**kwargs):
                self.calls.append((name,kwargs['max_tokens']))
                return copy.deepcopy(original) if name=='02-scene-1' else {'patches':[{'op':'replace','path':'/shots/0/camera/margin','value':1.3}]}
        with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as folder:
            job=Job(Path(folder),{'prompt':'An animation','events':[]});director=FakeDirector()
            result=create_scene(job,director,{},10)
            self.assertEqual(result['shots'][0]['camera']['margin'],1.3)
            self.assertEqual(director.calls,[('02-scene-1',16384),('02-scene-patch-1',4096)])
            self.assertIsNone(job.data['scene_repair'])
    def test_missing_shots_can_be_added_without_replacing_assets(self):
        original=scene();shots=original.pop('shots')
        patched=apply_scene_patch(original,[{'op':'add','path':'/shots','value':shots}])
        validate(patched,10);self.assertEqual(patched['assets'],original['assets'])

if __name__=='__main__':unittest.main()
