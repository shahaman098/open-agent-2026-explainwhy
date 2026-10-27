import io
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
import asset_library as library
from schema import validate
from test_v2 import scene

def glb(change=None):
    doc={'asset':{'version':'2.0'},'buffers':[{'byteLength':36}],'bufferViews':[{'buffer':0,'byteLength':36}],
         'accessors':[{'bufferView':0,'componentType':5126,'count':3,'type':'VEC3'}],
         'meshes':[{'primitives':[{'attributes':{'POSITION':0}}]}],'nodes':[{'mesh':0}],'scenes':[{'nodes':[0]}]}
    if change:change(doc)
    raw=json.dumps(doc).encode();raw+=b' '*(-len(raw)%4);binary=bytes(36)
    return struct.pack('<III',0x46546c67,2,12+8+len(raw)+8+len(binary))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(binary),0x004e4942)+binary

class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=tempfile.gettempdir());self.root=patch.object(library,'ROOT',Path(self.tmp.name));self.root.start()
    def tearDown(self):self.root.stop();self.tmp.cleanup()
    def test_image_is_reencoded_without_source_metadata(self):
        im=Image.new('RGB',(32,16),'#6080a0');stream=io.BytesIO();im.save(stream,format='PNG');item=library.add_image(stream.getvalue(),'../test.png')
        self.assertEqual(item['name'],'test.png');self.assertEqual(item['width'],32)
        with Image.open(library.asset_path(item['id'])) as clean:self.assertFalse(clean.info)
        with self.assertRaises(ValueError):library.asset_path('../../secret')
    def test_embedded_glb_registered_and_can_be_referenced_by_scene(self):
        item=library.add_model(glb(),'Triangle');s=scene();s['assets'][0]['parts'][0].update(shape='library',source=item['id'],size=[2,2,2])
        validated=validate(s,5);self.assertEqual(validated['capability_summary']['estimated_vertices'],3)
        self.assertEqual(library.get(item['id'])['sha256'],item['sha256'])
    def test_external_files_and_network_uris_are_rejected(self):
        for change in (lambda d:d['buffers'][0].update(uri='https://example.org/model.bin'),lambda d:d.update(images=[{'uri':'../../secret.png'}])):
            with self.assertRaisesRegex(ValueError,'embedded'):library.add_model(glb(change))
        self.assertFalse(list(Path(self.tmp.name).glob('*.glb')))
    def test_cyclic_or_oversized_models_are_rejected(self):
        for change in (lambda d:d['nodes'][0].update(children=[0]),lambda d:d['accessors'][0].update(count=2000001)):
            with self.assertRaises(ValueError):library.add_model(glb(change))
    def test_image_maps_require_registered_images(self):
        s=scene();s['materials'][0]['maps']={'normal':'image_'+'0'*32}
        with self.assertRaises(ValueError):validate(s,5)

if __name__=='__main__':unittest.main()
