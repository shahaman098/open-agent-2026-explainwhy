"""Optional installed macOS voices. Text is a file argument, never shell code."""
import functools
import re
import subprocess
from pathlib import Path

@functools.lru_cache(maxsize=1)
def voices():
    if not Path('/usr/bin/say').is_file():return []
    result=subprocess.run(['/usr/bin/say','-v','?'],capture_output=True,text=True,timeout=20,check=True)
    items=[]
    for line in result.stdout.splitlines():
        match=re.match(r'^(.*?)\s+([a-z]{2}_[A-Z]{2})\s+#',line)
        if match:items.append({'id':match[1].strip(),'locale':match[2]})
    return list({(item['id'],item['locale']):item for item in items}.values())

def validate_voice(id):
    if id not in {v['id'] for v in voices()}:raise ValueError('Choose an installed macOS voice')
    return id
