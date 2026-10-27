"""Expanded geometry, animation and cinematography contract checks."""
import copy
import math
import unittest
from schema import validate,apply_scene_patch
from scene_math import PathSampler,spline,ribbon_mesh,lathe_mesh,terrain_height

def scene():
    return {'version':2,'title':'Expanded test','summary':'An editable animated scene',
      'materials':[{'id':'metal','color':'#123456'}],
      'assets':[{'id':'body','name':'Body','parts':[{'id':'shell','shape':'box','material':'metal','size':[2,1,1]}]}],
      'instances':[{'id':'hero','asset':'body'}],
      'shots':[{'start':0,'end':5,'label':'Reveal','camera':{'focus':'hero'}}]}

class V2Tests(unittest.TestCase):
    def test_expanded_defaults_and_input_immutability(self):
        source=scene();before=copy.deepcopy(source);s=validate(source,5)
        self.assertEqual(before,source);self.assertEqual(s['version'],2);self.assertTrue(s['assets'][0]['allow_disconnected'])
    def test_material_namespaces_are_supported_without_weakening_object_ids(self):
        s=scene();s['materials'][0]['id']='lamp:bronze';s['assets'][0]['parts'][0]['material']='lamp:bronze';validate(s,5)
        s['assets'][0]['parts'][0]['id']='lamp:body'
        with self.assertRaises(ValueError):validate(s,5)
    def test_mesh_faces_are_checked(self):
        for faces in ([[0,1,4]],[[0,1,True]],[[0,0,1]],[[0,1]]):
            s=scene();s['assets'][0]['parts'][0].update(shape='mesh',vertices=[[0,0,0],[1,0,0],[0,1,0]],faces=faces)
            with self.subTest(faces=faces),self.assertRaises(ValueError):validate(s,5)
    def test_hierarchy_cycles_and_bad_boolean_targets_rejected(self):
        for change in ({'parent':'shell'},{'modifiers':[{'type':'boolean','target':'shell'}]}):
            s=scene();s['assets'][0]['parts'][0].update(change)
            with self.assertRaises(ValueError):validate(s,5)
        s=scene();s['instances'][0]['parent']='missing'
        with self.assertRaises(ValueError):validate(s,5)
    def test_path_and_camera_references_checked(self):
        s=scene();s['instances'][0]['follow_path']={'path':'missing'}
        with self.assertRaises(ValueError):validate(s,5)
        s=scene();s['shots'][0]['camera']={'path':'missing','focus':'hero'}
        with self.assertRaises(ValueError):validate(s,5)
    def test_free_camera_is_preserved(self):
        s=scene();s['shots'][0]['camera']={'position':[10,-20,5],'target':[0,0,0],'lens':12,'dof':{'fstop':2.8,'distance':8}}
        self.assertEqual(validate(s,5)['shots'][0]['camera']['position'],[10,-20,5])
    def test_orthographic_camera_has_bounded_scale_and_one_projection_per_shot(self):
        s=scene();s['shots'][0]['camera']={'position':[6,-24,10],'target':[0,0,0],'projection':'ORTHO','ortho_scale':20}
        result=validate(s,5);self.assertEqual(result['shots'][0]['camera']['projection'],'ORTHO')
        s['shots'][0]['camera']['ortho_scale']=0
        with self.assertRaises(ValueError):validate(s,5)
        s['shots'][0]['camera']['ortho_scale']=20;s['shots'][0]['camera_end']={'position':[8,-24,10],'target':[0,0,0],'projection':'PERSP'}
        with self.assertRaisesRegex(ValueError,'projection'):validate(s,5)
    def test_known_camera_alias_and_encoded_vectors_are_normalized(self):
        s=scene();s['paths']=[{'id':'track','points':[[0,-4,2],[4,-4,2]]}]
        s['shots'][0]['camera'].update(follow_path={'path':'track','start':.1,'end':.9},target_offset='[0,0,1]')
        s['instances'][0]['position']='[0,0,0]'
        result=validate(s,5);camera=result['shots'][0]['camera']
        self.assertEqual(camera['path'],'track');self.assertEqual(camera['path_start'],.1)
        self.assertEqual(camera['target_offset'],[0,0,1]);self.assertNotIn('follow_path',camera)
        self.assertIsInstance(s['instances'][0]['position'],str)
    def test_unknown_camera_keys_are_not_silently_ignored(self):
        s=scene();s['shots'][0]['camera']['magic_track']=True
        with self.assertRaisesRegex(ValueError,'camera'):validate(s,5)
    def test_named_patch_array_selectors_are_unambiguous_and_atomic(self):
        s=validate(scene(),5)
        changed=apply_scene_patch(s,[{'op':'replace','path':'/assets/body/parts/shell/size','value':[3,2,1]}])
        self.assertEqual(changed['assets'][0]['parts'][0]['size'],[3,2,1]);self.assertEqual(s['assets'][0]['parts'][0]['size'],[2,1,1])
        with self.assertRaises(ValueError):apply_scene_patch(s,[{'op':'replace','path':'/assets/missing/name','value':'X'}])
    def test_procedural_motion_and_part_keyframes(self):
        s=scene();p=s['assets'][0]['parts'][0];p['motion']={'spin':{'axis':'Y','speed':720}};p['animation']=[{'time':0,'visible':False},{'time':2,'visible':True}]
        validate(s,5)
        p['motion']['spin']['speed']=float('nan')
        with self.assertRaises(ValueError):validate(s,5)
    def test_generated_geometry_budget_accounts_for_scatter_and_modifiers(self):
        s=scene();p=s['assets'][0]['parts'][0];p.update(shape='terrain',size=[100,100,10],resolution=128,modifiers=[{'type':'subdivision','levels':3}]);s['scatter']=[{'asset':'body','count':2}]
        with self.assertRaisesRegex(ValueError,'budget'):validate(s,5)
    def test_complete_road_and_markings(self):
        s=scene();s['assets'][0]['parts'][0].update(shape='ribbon',points=[[-5,0,0],[0,2,0],[5,0,0]],width=4,markings={'material':'metal'})
        self.assertEqual(validate(s,5)['assets'][0]['parts'][0]['markings']['dash'],1)
    def test_lighting_and_render_controls_are_validated(self):
        s=scene();s['lights']=[{'id':'sun','type':'SUN','energy':2,'color':'#ff9944'}];s['environment']={'theme':'sky','sky':{'sun_elevation':10},'fog':{'density':.001}};s['render']={'bloom':.1,'motion_blur':True}
        validate(s,5);s['lights'][0]['energy']=-1
        with self.assertRaises(ValueError):validate(s,5)
    def test_patches_can_edit_lighting_without_geometry_changes(self):
        s=validate(scene(),5);patched=apply_scene_patch(s,[{'op':'add','path':'/lights','value':[{'id':'key','type':'AREA','energy':500}]}]);validate(patched,5)
        self.assertEqual(s['assets'],patched['assets'])
    def test_continuous_spline_road_has_no_segment_gaps(self):
        points=spline([[-5,0,0],[0,3,0],[5,0,0]],16);verts,faces=ribbon_mesh(points,4)
        self.assertEqual(len(faces),len(points)-1)
        for a,b in zip(faces,faces[1:]):self.assertEqual(set(a)&set(b),{b[0],b[1]})
        self.assertEqual(points[0],[-5,0,0]);self.assertEqual(points[-1],[5,0,0])
    def test_path_speed_is_parameterized_by_arc_length(self):
        path=PathSampler([[0,0,0],[2,0,0],[12,0,0]],64)
        self.assertAlmostEqual(path.at(.5)[0][0],6,delta=.05)
        self.assertEqual(path.at(0)[0],[0,0,0]);self.assertEqual(path.at(1)[0],[12,0,0])
    def test_terrain_is_reproducible_and_clearings_are_flat(self):
        spec={'size':[100,100,10],'seed':7,'flatten':[{'center':[0,0],'radius':5,'height':2}]}
        self.assertEqual(terrain_height(0,0,spec),2);self.assertEqual(terrain_height(20,20,spec),terrain_height(20,20,spec))
        self.assertNotEqual(terrain_height(20,20,spec),terrain_height(20,20,spec|{'seed':8}))
    def test_lathe_is_closed_when_requested(self):
        vertices,faces=lathe_mesh([[1,0],[.5,2]],32,True)
        self.assertEqual(len(vertices),64);self.assertEqual(len(faces),34)

if __name__=='__main__':unittest.main()
