"""Content-addressed local images and self-contained GLB assets. No remote fetches."""
import hashlib
import io
import json
import os
import re
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parent/'asset_library'
MAX_IMAGE=12*1024**2
MAX_MODEL=64*1024**2
MAX_AUDIO=64*1024**2

def clean_name(name):return Path(str(name or 'Untitled asset')).name[:200]
def metadata_path(id):
    if not isinstance(id,str) or not re.fullmatch(r'(?:image|model|audio)_[0-9a-f]{32}',id):raise ValueError('Invalid library asset ID')
    return ROOT/(id+'.json')
def get(id,kind=None):
    path=metadata_path(id)
    if not path.is_file():raise ValueError('Library asset is not registered: '+id)
    data=json.loads(path.read_text())
    if kind and data['kind']!=kind:raise ValueError('Wrong library asset type')
    return data
def asset_path(id,kind=None):
    item=get(id,kind);return ROOT/(id+{'image':'.png','model':'.glb','audio':'.audio'}[item['kind']])
def catalog():
    if not ROOT.exists():return []
    result=[]
    for path in sorted(ROOT.glob('*.json')):
        try:result.append(get(path.stem))
        except (ValueError,OSError,KeyError):continue
    return result
def write(id,data,metadata,suffix):
    ROOT.mkdir(exist_ok=True)
    path=ROOT/(id+suffix);temporary=path.with_suffix(suffix+'.tmp');temporary.write_bytes(data);temporary.replace(path)
    mp=metadata_path(id);tmp=mp.with_suffix('.tmp');tmp.write_text(json.dumps(metadata,ensure_ascii=False,indent=2));tmp.replace(mp)
    return metadata

def add_image(raw,name='Image'):
    if not 0<len(raw)<=MAX_IMAGE:raise ValueError('Image must be at most 12 MiB')
    from PIL import Image,ImageOps
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.format not in ('PNG','JPEG','WEBP') or source.width*source.height>25000000:raise ValueError('Use PNG/JPEG/WebP up to 25 megapixels')
            source.load();image=ImageOps.exif_transpose(source).convert('RGBA');image.thumbnail((2048,2048))
            clean=Image.new('RGBA',image.size);clean.paste(image);stream=io.BytesIO();clean.save(stream,format='PNG');data=stream.getvalue()
    except (OSError,Image.DecompressionBombError) as error:raise ValueError('Invalid or oversized image') from error
    digest=hashlib.sha256(data).hexdigest();id='image_'+digest[:32]
    return write(id,data,{'id':id,'kind':'image','name':clean_name(name),'width':clean.width,'height':clean.height,'bytes':len(data),'sha256':digest,'url':'/library/'+id+'.png'},'.png')

def inspect_glb(raw):
    if not 20<=len(raw)<=MAX_MODEL:raise ValueError('GLB must be at most 64 MiB')
    magic,version,length=struct.unpack_from('<III',raw)
    if magic!=0x46546c67 or version!=2 or length!=len(raw):raise ValueError('Expected a complete binary glTF 2.0 file')
    offset=12;document=None;binary_length=0;chunks=0
    while offset<len(raw):
        if offset+8>len(raw):raise ValueError('Truncated GLB chunk')
        size,typ=struct.unpack_from('<II',raw,offset);offset+=8
        if size%4 or offset+size>len(raw):raise ValueError('Invalid GLB chunk size')
        if chunks==0 and typ!=0x4e4f534a:raise ValueError('First GLB chunk must be JSON')
        if typ==0x4e4f534a:
            if document is not None or size>8*1024**2:raise ValueError('Invalid GLB JSON chunk')
            document=json.loads(raw[offset:offset+size].decode('utf-8').rstrip('\x00 '))
        elif typ==0x004e4942:binary_length+=size
        else:raise ValueError('Unsupported GLB chunk type')
        offset+=size;chunks+=1
    if not isinstance(document,dict) or document.get('asset',{}).get('version')!='2.0':raise ValueError('Invalid glTF document')
    allowed={'KHR_lights_punctual','KHR_materials_clearcoat','KHR_materials_transmission','KHR_materials_volume','KHR_materials_ior','KHR_materials_sheen','KHR_materials_specular','KHR_materials_unlit','KHR_texture_transform','KHR_materials_emissive_strength','KHR_materials_anisotropy','KHR_mesh_quantization'}
    if set(document.get('extensionsRequired',[]))-allowed:raise ValueError('Decompress or convert unsupported required GLB extensions before importing')
    if any(ext in document.get('extensionsUsed',[]) for ext in ('KHR_draco_mesh_compression','EXT_meshopt_compression')):raise ValueError('Use an uncompressed GLB so geometry limits can be checked before import')
    for buffer in document.get('buffers',[]):
        if buffer.get('uri') is not None:raise ValueError('GLB buffers must be embedded, without external URIs')
        if type(buffer.get('byteLength')) is not int or not 0<=buffer['byteLength']<=binary_length:raise ValueError('Buffer exceeds embedded binary data')
    if len(document.get('buffers',[]))>1:raise ValueError('Use a single embedded GLB buffer')
    for image in document.get('images',[]):
        if 'uri' in image:raise ValueError('GLB images must use embedded bufferViews, without file paths or data URIs')
    for view in document.get('bufferViews',[]):
        start=view.get('byteOffset',0);count=view.get('byteLength')
        if view.get('buffer',0)!=0 or type(start) is not int or type(count) is not int or start<0 or count<0 or start+count>binary_length:raise ValueError('Invalid embedded bufferView')
    accessors=document.get('accessors',[])
    for accessor in accessors:
        count=accessor.get('count')
        if type(count) is not int or not 0<=count<=2000000:raise ValueError('Accessor count exceeds geometry limits')
    meshes=document.get('meshes',[]);mesh_cost=[]
    if not meshes or len(meshes)>512:raise ValueError('GLB needs 1..512 meshes')
    for mesh in meshes:
        vertices=0
        for primitive in mesh.get('primitives',[]):
            index=primitive.get('attributes',{}).get('POSITION')
            if type(index) is not int or not 0<=index<len(accessors):raise ValueError('Mesh has no valid POSITION accessor')
            vertices+=accessors[index]['count']
        mesh_cost.append(vertices)
    nodes=document.get('nodes',[])
    if not 1<=len(nodes)<=2048:raise ValueError('GLB needs 1..2048 nodes')
    vertices=0
    for node in nodes:
        if 'mesh' in node:
            index=node['mesh']
            if type(index) is not int or not 0<=index<len(mesh_cost):raise ValueError('Invalid mesh node')
            vertices+=mesh_cost[index]
    if not 1<=vertices<=2000000:raise ValueError('GLB exceeds the 2M vertex budget')
    # Reject node cycles before handing hierarchy construction to Blender.
    visiting=set();visited=set()
    def visit(index):
        if type(index) is not int or not 0<=index<len(nodes):raise ValueError('Invalid GLB child node')
        if index in visiting:raise ValueError('Cyclic GLB node hierarchy')
        if index in visited:return
        visiting.add(index)
        for child in nodes[index].get('children',[]):visit(child)
        visiting.remove(index);visited.add(index)
    for index in range(len(nodes)):visit(index)
    return {'vertices':vertices,'objects':len(nodes),'meshes':len(meshes),'materials':len(document.get('materials',[])),'animations':len(document.get('animations',[])),'embedded_images':len(document.get('images',[]))}

def add_model(raw,name='3D model'):
    try:info=inspect_glb(raw)
    except (struct.error,UnicodeError,TypeError,KeyError,AttributeError,IndexError,OverflowError,RecursionError) as error:raise ValueError('Invalid GLB structure') from error
    digest=hashlib.sha256(raw).hexdigest();id='model_'+digest[:32]
    return write(id,raw,{'id':id,'kind':'model','name':clean_name(name),'bytes':len(raw),'sha256':digest,'url':'/library/'+id+'.glb',**info},'.glb')

def add_audio(raw,name='Soundtrack'):
    if not 0<len(raw)<=MAX_AUDIO:raise ValueError('Audio must be at most 64 MiB')
    with tempfile.TemporaryDirectory(dir='/private/tmp') as temp:
        path=Path(temp)/'upload.audio';path.write_bytes(raw)
        try:
            result=subprocess.run([os.environ.get('ORBIT_FFPROBE',shutil.which('ffprobe') or 'ffprobe'),'-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',str(path)],capture_output=True,text=True,timeout=20,check=True)
            info=json.loads(result.stdout);streams=info.get('streams',[])
            if not streams or any(s.get('codec_type')!='audio' for s in streams):raise ValueError('Upload an audio-only file')
            allowed={'mp3','wav','aiff','flac','ogg','mov,mp4,m4a,3gp,3g2,mj2'}
            if info.get('format',{}).get('format_name') not in allowed:raise ValueError('Use a self-contained standard audio file')
            duration=float(info['format']['duration'])
            if not 0<duration<=1800:raise ValueError('Audio must be between zero and 30 minutes')
        except (subprocess.SubprocessError,ValueError,KeyError) as error:raise ValueError('Use a valid MP3, WAV, M4A, Ogg or FLAC audio file up to 30 minutes') from error
    digest=hashlib.sha256(raw).hexdigest();id='audio_'+digest[:32]
    return write(id,raw,{'id':id,'kind':'audio','name':clean_name(name),'bytes':len(raw),'sha256':digest,'duration':duration},'.audio')
