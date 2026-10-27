"""Meaningful bounds/reference checks for untrusted local-model output."""
import copy
import unittest
from schema import validate,parse_json,repair_delimiters

def scene():
    return {'title':'Test','summary':'A test scene',
        'materials':[{'id':'metal','color':'#e2c590'}],
        'assets':[{'id':'satellite','name':'Satellite','parts':[{'id':'body','shape':'box','material':'metal','size':[1,1,1]}]}],
        'instances':[{'id':'hero','asset':'satellite','animation':[{'time':0,'rotation':[0,0,0]},{'time':10,'rotation':[0,0,45]}]}],
        'shots':[{'start':0,'end':10,'label':'Reveal','camera':{'position':[5,-9,4],'target':[0,0,0]}}]}

class SceneTests(unittest.TestCase):
    def test_valid_scene_and_safe_defaults(self):
        s=validate(scene(),10);self.assertEqual(s['assets'][0]['parts'][0]['position'],[0,0,0]);self.assertEqual(s['shots'][0]['camera']['lens'],45)
    def test_references(self):
        s=scene();s['instances'][0]['asset']='missing'
        with self.assertRaises(ValueError):validate(s,10)
    def test_numeric_overflows_and_nan(self):
        for value in [float('nan'),float('inf'),-1,10**9,True]:
            with self.subTest(value=value):
                s=scene();s['assets'][0]['parts'][0]['size'][0]=value
                with self.assertRaises(ValueError):validate(s,10)
    def test_cameras_cannot_be_at_target(self):
        s=scene();s['shots'][0]['camera']['position']=[0,0,0]
        with self.assertRaises(ValueError):validate(s,10)
    def test_focus_camera_references(self):
        for focus in ['hero','hero:body']:
            s=scene();s['shots'][0]['camera']={'focus':focus};validate(s,10)
        for focus in ['missing','hero:missing']:
            s=scene();s['shots'][0]['camera']={'focus':focus}
            with self.assertRaises(ValueError):validate(s,10)
    def test_timeline_gaps_overlap_and_wrong_duration(self):
        for start,end in [(1,10),(0,9),(0,11),(0,0)]:
            with self.subTest(start=start,end=end):
                s=scene();s['shots'][0].update(start=start,end=end)
                with self.assertRaises(ValueError):validate(s,10)
    def test_unordered_animation(self):
        s=scene();s['instances'][0]['animation'].reverse()
        with self.assertRaises(ValueError):validate(s,10)
    def test_unsupported_code_or_shape(self):
        s=scene();s['assets'][0]['parts'][0]['shape']='exec'
        with self.assertRaises(ValueError):validate(s,10)
        with self.assertRaises(ValueError):parse_json('import os; os.system("anything")')
    def test_path_ids_rejected(self):
        s=scene();s['assets'][0]['id']='../../escape'
        with self.assertRaises(ValueError):validate(s,10)
    def test_generated_grid_budget(self):
        s=scene();p=s['assets'][0]['parts'][0];p.update(shape='panel',rows=12,columns=16)
        s['assets'][0]['parts']=[p|{'id':f'panel{i}'} for i in range(30)]
        with self.assertRaisesRegex(ValueError,'budget'):validate(s,10)
    def test_reasoning_is_not_json_input(self):
        s=parse_json('private reasoning</think>```json\n{"title":"Public answer"}\n```')
        self.assertEqual(s,{'title':'Public answer'})
    def test_original_input_not_mutated(self):
        s=scene();original=copy.deepcopy(s);validate(s,10);self.assertEqual(s,original)
    def test_repair_only_unmatched_closers_not_string_content(self):
        obj,n=repair_delimiters('{"label":"}] stays in string","changes":{"shots":[]}}]}')
        self.assertEqual(obj,{'label':'}] stays in string','changes':{'shots':[]}});self.assertGreater(n,0)
    def test_repair_does_not_invent_missing_values(self):
        with self.assertRaises(ValueError):repair_delimiters('{"changes":[')

if __name__=='__main__':unittest.main()
