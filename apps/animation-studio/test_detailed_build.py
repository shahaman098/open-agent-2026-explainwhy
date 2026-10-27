import copy
import tempfile
import unittest
from pathlib import Path
from pipeline import Job,create_detailed_scene,review_context,merge_asset_materials,build_one_asset,repair_scene
from test_v2 import scene

class DetailedBuildTests(unittest.TestCase):
    def test_repeated_materials_are_reused_or_namespaced_without_touching_previous_assets(self):
        original=[{'id':'metal','color':'#123456','roughness':.4}];asset={'id':'lamp','parts':[{'id':'body','material':'metal'}]}
        materials,body,aliases=merge_asset_materials(original,[{'id':'metal','color':'#123456'}],asset,'lamp')
        self.assertEqual(len(materials),1);self.assertEqual(aliases,{})
        materials,body,aliases=merge_asset_materials(original,[{'id':'metal','color':'#abcdef'}],asset,'lamp')
        self.assertEqual(len(materials),2);self.assertEqual(body['parts'][0]['material'],aliases['metal'])
        self.assertEqual(original[0]['color'],'#123456');self.assertEqual(asset['parts'][0]['material'],'metal')
    def test_assets_are_generated_separately_and_assembled_with_original_ids(self):
        original=scene();layout=copy.deepcopy(original);layout['assets'][0]['parts']=[];layout['assets'][0]['dimensions']=[2,1,1]
        class Fake:
            entry={'backend':'openrouter'}
            def __init__(self):self.names=[]
            def generate(self,job,name,system,user,**kwargs):
                self.names.append(name)
                if name=='02-layout':return copy.deepcopy(layout)
                return {'asset':copy.deepcopy(original['assets'][0]),'materials':[]}
        with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as directory:
            job=Job(Path(directory),{'id':'test','prompt':'A product film','events':[]});director=Fake()
            result=create_detailed_scene(job,director,{},5)
            self.assertEqual(director.names,['02-layout','02-asset-body']);self.assertEqual(result['assets'][0]['id'],'body')
            self.assertEqual(job.data['build_progress']['completed'],1);self.assertTrue((Path(directory)/'blueprint.json').exists())
    def test_visual_review_context_keeps_bounds_but_omits_dense_topology(self):
        s=scene();p=s['assets'][0]['parts'][0];p.update(shape='mesh',vertices=[[0,0,0],[1,0,0],[0,1,0]],faces=[[0,1,2]])
        compact=review_context(s);part=compact['assets'][0]['parts'][0]
        self.assertNotIn('vertices',part);self.assertEqual(part['topology_summary']['bounds'],[[0,1],[0,1],[0,0]])
        self.assertIn('vertices',s['assets'][0]['parts'][0])
    def test_wrong_asset_identity_is_retried_without_global_hero_brief(self):
        s=scene();contract={'id':'body','name':'Desk surface','description':'Only a desk surface, no lamp','dimensions':[2,1,1]}
        class Fake:
            entry={}
            def __init__(self):self.calls=[]
            def generate(self,job,name,system,user,**kwargs):
                self.calls.append((name,user));asset=copy.deepcopy(s['assets'][0])
                if len(self.calls)==1:asset['id']='wrong_lamp'
                return {'asset':asset,'materials':[]}
        with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as directory:
            job=Job(Path(directory),{'id':'test','prompt':'Unfold a brass lamp hero','stage':'modeling','events':[]});d=Fake()
            asset,mats=build_one_asset(job,d,contract,s['materials'],5,{})
            self.assertEqual(asset['id'],'body');self.assertEqual(len(d.calls),2)
            self.assertNotIn('Unfold a brass lamp hero',d.calls[0][1]);self.assertIn('Desk surface',d.calls[0][1])
    def test_wrong_subject_is_never_silently_relabelled(self):
        class Fake:
            entry={}
            def generate(self,*args,**kwargs):return {'asset':{'id':'wrong','parts':[]}}
        with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as directory:
            job=Job(Path(directory),{'id':'test','stage':'modeling','events':[]})
            with self.assertRaisesRegex(ValueError,'contracted identity'):
                build_one_asset(job,Fake(),{'id':'desk','name':'Desk'},scene()['materials'],5,{})
    def test_invalid_corrective_patch_gets_one_retry_without_losing_source(self):
        s=scene();s['materials'][0]['color']='invalid';before=copy.deepcopy(s)
        class Fake:
            def __init__(self):self.calls=[]
            def generate(self,job,name,system,user,**kwargs):
                self.calls.append(user)
                return {'patches':[{'op':'replace','path':'/materials/999/color' if len(self.calls)==1 else '/materials/0/color','value':'#123456'}]}
        with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as directory:
            job=Job(Path(directory),{'id':'test','stage':'modeling','events':[]});d=Fake()
            result=repair_scene(job,d,s,5,'02-asset-test')
            self.assertEqual(len(d.calls),2);self.assertIn('previous corrective patch failed',d.calls[1])
            self.assertEqual(result['materials'][0]['color'],'#123456');self.assertEqual(s,before)

if __name__=='__main__':unittest.main()
