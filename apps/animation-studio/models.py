"""Local checkpoint inventory. Discovery reads JSON and file sizes, never model code."""
import hashlib
import json
import threading
from pathlib import Path

from pipeline import MODEL, ROOT, atomic_json
import lmstudio_backend as studio
import openrouter_backend as router

REGISTRY = ROOT / 'local-models.json'
MODEL_LIMIT = 94 * 1024**3
SUPPORTED = {
    'nemotron_h_omni', 'nemotronh_nano_omni_reasoning_v3', 'nemotron_h_nano_omni',
    'qwen3_5', 'qwen3_5_moe', 'qwen3_vl', 'qwen3_vl_moe', 'qwen2_5_vl',
    'qwen2_vl', 'qwen3', 'qwen3_moe', 'qwen3_next', 'qwen2', 'llama',
    'gemma3', 'gemma4', 'mistral', 'gpt_oss', 'phi3_v', 'llava',
}


def describe(path):
    path = Path(path).expanduser().resolve(strict=True)
    config_path = path / 'config.json'
    if not path.is_dir() or not config_path.is_file():
        raise ValueError('Choose a local model folder containing config.json and safetensors weights.')
    if config_path.stat().st_size > 4 * 1024**2:
        raise ValueError('Model config is too large.')
    config = json.loads(config_path.read_text())
    weights = list(path.glob('*.safetensors'))
    size = sum(f.stat().st_size for f in weights)
    missing = False
    index = path / 'model.safetensors.index.json'
    if index.is_file():
        if index.stat().st_size > 32 * 1024**2:
            raise ValueError('Model weight index is too large.')
        shards = set(json.loads(index.read_text()).get('weight_map', {}).values())
        for shard in shards:
            if not isinstance(shard, str) or Path(shard).name != shard:
                raise ValueError('Weight index must reference files inside the model folder.')
            if not (path / shard).is_file():
                missing = True
    typ = config.get('model_type', '')
    trusted = path == MODEL.resolve()
    quant = config.get('quantization') or config.get('quantization_config') or {}
    bits = quant.get('bits')
    vision = bool(config.get('vision_config') or config.get('vision_tower') or 'vl' in typ or 'omni' in typ)
    name = 'NVIDIA Nemotron 3.5 Bolt · 4-bit' if trusted else path.name
    reason = None
    if not weights or missing:
        reason = 'Weights are missing or the download is incomplete.'
    elif size > MODEL_LIMIT:
        reason = 'Weights exceed the 94 GiB model memory budget. Choose a quantized checkpoint.'
    elif typ not in SUPPORTED:
        reason = f'This animation backend does not support architecture {typ or "unknown"} yet.'
    elif config.get('model_file'):
        reason = 'Checkpoints that execute a custom model_file are not enabled.'
    elif config.get('auto_map') and not trusted:
        reason = 'This checkpoint requires custom Python code. Use a model supported by the built-in backend.'
    tokenizer_config = path / 'tokenizer_config.json'
    template = ''
    if tokenizer_config.is_file() and tokenizer_config.stat().st_size < 8 * 1024**2:
        tc = json.loads(tokenizer_config.read_text())
        template = str(tc.get('chat_template', ''))
        if tc.get('auto_map') and not trusted:
            reason = 'This tokenizer requires custom Python code and is not enabled.'
    if typ == 'gpt_oss':
        reasoning_format = 'harmony'
    elif 'nemotron' in typ or '</think>' in template:
        reasoning_format = 'think'
    else:
        reasoning_format = 'plain'
    return {
        'backend':'mlx', 'format':'mlx',
        'id': hashlib.sha256(str(path).encode()).hexdigest()[:16],
        'name': name, 'path': str(path), 'size_bytes': size, 'bits': bits,
        'model_type': typ, 'vision': vision, 'reasoning_format': reasoning_format,
        'reasoning': reasoning_format != 'plain', 'supported': reason is None,
        'reason': reason, 'trust_remote_code': trusted,
    }

def describe_studio(item):
    key=item['key'];caps=item.get('capabilities',{});reasoning=caps.get('reasoning') or {}
    quant=item.get('quantization') or {}
    return {'id':hashlib.sha256(('lmstudio:'+key).encode()).hexdigest()[:16],
            'backend':'lmstudio','format':item.get('format','gguf'),
            'name':item.get('display_name',key)+' · LM Studio', 'path':'lmstudio:'+key,
            'lm_model_key':key,'size_bytes':item.get('size_bytes',0),'bits':quant.get('bits_per_weight'),
            'model_type':item.get('architecture',''), 'vision':caps.get('vision',False),
            'reasoning':bool(reasoning),'reasoning_format':'plain',
            'reasoning_option':reasoning.get('default'), 'supported':True,'reason':None,
            'trust_remote_code':False}

def describe_router():
    return {'id':hashlib.sha256(('openrouter:'+router.MODEL_ID).encode()).hexdigest()[:16],
            'backend':'openrouter','format':'api','name':'DeepSeek V4.1 Flash 1017 · OpenRouter',
            'path':'openrouter:'+router.MODEL_ID,'api_model':router.MODEL_ID,'size_bytes':0,'bits':None,
            'model_type':'deepseek_v4_1','vision':True,'reasoning':True,'reasoning_format':'plain',
            'supported':True,'reason':None,'trust_remote_code':False}


class Catalog:
    def __init__(self, registry=REGISTRY, roots=None, provider_only=None):
        self.registry = Path(registry)
        if provider_only not in (None,'openrouter'):raise ValueError('Unsupported provider restriction')
        self.provider_only=provider_only
        self.roots = roots if roots is not None else [MODEL.parent, Path.home()/'.lmstudio/models', Path.home()/'.cache/huggingface/hub']
        self.lock = threading.RLock()
        self.include_studio=roots is None
        self.items = {}
        try:
            self.saved = json.loads(self.registry.read_text())
        except (OSError, ValueError):
            self.saved = {}
        self.refresh()

    def refresh(self):
        if self.provider_only=='openrouter':
            cloud=describe_router()
            with self.lock:self.items={cloud['id']:cloud}
            return self.list()
        paths = {str(MODEL), *self.saved.get('paths', [])}
        for root in self.roots:
            root = Path(root)
            # Known layouts only; never descend into virtual environments or scan the disk.
            patterns = ('*/config.json', '*/*/config.json', 'models--*/snapshots/*/config.json')
            for pattern in patterns:
                paths.update(str(p.parent) for p in root.glob(pattern))
        items = {}
        for path in sorted(paths):
            try:
                entry = describe(path)
                items[entry['id']] = entry
            except (OSError, ValueError, TypeError, AttributeError):
                continue
        if self.include_studio:
            try:remote=[describe_studio(m) for m in studio.models() if m.get('type')=='llm' and m.get('format')=='gguf']
            except studio.StudioError:remote=self.saved.get('lm_models',[])
            items.update({entry['id']:entry for entry in remote})
        cloud=describe_router();items[cloud['id']]=cloud
        with self.lock:
            self.items = items
        return self.list()

    def list(self):
        with self.lock:
            return sorted(self.items.values(), key=lambda m: (m['path'] != str(MODEL.resolve()), not m['supported'], m['name']))

    def get(self, model_id):
        with self.lock:
            if not isinstance(model_id, str) or model_id not in self.items:
                raise ValueError('This app uses only DeepSeek through OpenRouter.' if self.provider_only else 'Choose a model from the model list.')
            # Revalidate files immediately before selection/loading.
            previous=self.items[model_id]
            entry = describe_router() if previous.get('backend')=='openrouter' else describe_studio(studio.find_model(previous['lm_model_key'])) if previous.get('backend')=='lmstudio' else describe(previous['path'])
            if not entry['supported']:
                raise ValueError(entry['reason'])
            return entry

    def selected(self):
        try:
            return self.get(self.saved.get('selected'))
        except (ValueError, OSError, studio.StudioError):
            if self.saved.get('selected') in self.items:return self.items[self.saved['selected']]
            return next((m for m in self.list() if m['supported']), None)

    def select(self, model_id):
        entry = self.get(model_id)
        with self.lock:
            self.saved['selected'] = entry['id']
            self.saved['lm_models']=[m for m in self.items.values() if m.get('backend')=='lmstudio']
            self.registry.parent.mkdir(parents=True, exist_ok=True)
            atomic_json(self.registry, self.saved)
        return entry

    def add(self, path):
        if self.provider_only:raise ValueError('Local models are disabled. This app uses only DeepSeek through OpenRouter.')
        if not isinstance(path, str) or len(path) > 4096 or not Path(path).expanduser().is_absolute():
            raise ValueError('Enter an absolute local model folder path.')
        entry = describe(path)
        if not entry['supported']:
            raise ValueError(entry['reason'])
        with self.lock:
            self.saved['paths'] = sorted(set(self.saved.get('paths', []) + [entry['path']]))
            atomic_json(self.registry, self.saved)
            self.items[entry['id']] = entry
        return entry
