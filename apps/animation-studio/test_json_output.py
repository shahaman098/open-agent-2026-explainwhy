"""Exercise the real grammar with a tiny character tokenizer, no model/GPU."""
import unittest
from json_output import JsonOutput,CRITIQUE,EDIT,ASSET,PATCH,schema_for,tokenizer_data

class CharTokenizer:
    all_special_ids=[128]
    eos_token_id=128
    def __len__(self):return 129
    def encode(self,text,**kwargs):return list(text.encode('ascii'))
    def decode(self,ids,**kwargs):return ''.join(chr(i) for i in ids if i<128)

class JsonOutputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.data=tokenizer_data(CharTokenizer())
    def advance(self,output,prefix,text):
        for token in text.encode('ascii'):
            self.assertIn(token,output.allowed(prefix));prefix.append(token)
        return prefix
    def test_reasoning_is_free_but_public_answer_must_be_json(self):
        output=JsonOutput(self.data,CRITIQUE,[999]);self.assertIsNone(output.allowed([999,10])) # template marker ignored
        self.assertIsNone(output.allowed([999,10,65]))
        prefix=[999,10,65,999]
        allowed=output.allowed(prefix);self.assertIn(ord('{'),allowed);self.assertNotIn(ord('L'),allowed)
        self.advance(output,prefix,'{"assessment":"Clear","issues":[]}')
        self.assertIn(128,output.allowed(prefix));self.assertNotIn(ord('{'),output.allowed(prefix))
    def test_fifth_issue_and_unknown_fields_are_not_allowed(self):
        output=JsonOutput(self.data,CRITIQUE);prefix=[];output.allowed(prefix)
        self.advance(output,prefix,'{"assessment":"A","issues":["a","b","c","d"')
        allowed=output.allowed(prefix);self.assertIn(ord(']'),allowed);self.assertNotIn(ord(','),allowed)
        self.advance(output,prefix,']}');self.assertIn(128,output.allowed(prefix))
    def test_edit_schema_accepts_patch_values_and_targeted_rebuild(self):
        output=JsonOutput(self.data,EDIT);prefix=[];output.allowed(prefix)
        self.advance(output,prefix,'{"patches":[{"op":"add","path":"/lights/0/energy","value":42}],"rebuild_assets":[{"id":"desk","instruction":"Flat desk"}]}')
        self.assertIn(128,output.allowed(prefix))
        self.assertEqual(schema_for('03-review-1-edit-v2-rebuild-desk'),ASSET)
        self.assertEqual(schema_for('03-review-1-edit-v2'),EDIT)
    def test_edit_path_has_to_start_at_real_scene_data(self):
        output=JsonOutput(self.data,EDIT);prefix=[];output.allowed(prefix)
        self.advance(output,prefix,'{"patches":[{"op":"replace","path":"/sc')
        self.assertNotIn(ord('e'),output.allowed(prefix)) # /scenes/... is not a root
        self.advance(output,prefix,'atter/0/count","value":2}],"rebuild_assets":[]}')
        self.assertIn(128,output.allowed(prefix))
    def test_asset_builder_uses_real_shapes_and_flat_transform_fields(self):
        output=JsonOutput(self.data,ASSET);prefix=[];output.allowed(prefix)
        self.advance(output,prefix,'{"asset":{"id":"desk","name":"Desk","parts":[{"id":"top","shape":"box","material":"wood","size":[1,2,0.1],"position":[0,0,0]}]},"materials":[]}')
        self.assertIn(128,output.allowed(prefix));self.assertEqual(schema_for('02-asset-desk-patch-1'),PATCH)
        output=JsonOutput(self.data,ASSET);prefix=[];output.allowed(prefix)
        self.advance(output,prefix,'{"asset":{"id":"desk","name":"Desk","parts":[{"id":"top","shape":"')
        # "rounded_box" and nested "geometry" are not declared tools.
        self.advance(output,prefix,'ro');self.assertNotIn(ord('u'),output.allowed(prefix))
        self.assertEqual(schema_for('02-asset-desk'),ASSET)
    def test_extrusion_requires_polygon_and_numeric_depth(self):
        output=JsonOutput(self.data,ASSET);prefix=[];output.allowed(prefix)
        self.advance(output,prefix,'{"asset":{"id":"desk","name":"Desk","parts":[{"id":"top","shape":"extrude","material":"wood","depth":')
        self.assertNotIn(ord('['),output.allowed(prefix));self.assertNotIn(ord('{'),output.allowed(prefix))
        self.advance(output,prefix,'0.1');self.assertNotIn(ord('}'),output.allowed(prefix))
        self.advance(output,prefix,',"polygon":[[0,0],[1,0],[1,1]],"bevel":0.02}]},"materials":[]}')
        self.assertIn(128,output.allowed(prefix))
    def test_modifiers_and_new_materials_use_declared_typed_fields(self):
        output=JsonOutput(self.data,ASSET);prefix=[];output.allowed(prefix)
        self.advance(output,prefix,'{"asset":{"id":"desk","name":"Desk","parts":[{"id":"top","shape":"box","material":"wood","size":[1,2,0.1],"modifiers":[{"type":"bevel","width":0.02,"segments":3}]}]},"materials":[{"id":"wood","color":"#123456","roughness":0.6,"texture":{"type":"wood","scale":4}}]}')
        self.assertIn(128,output.allowed(prefix))

if __name__=='__main__':unittest.main()
