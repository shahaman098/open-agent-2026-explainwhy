"""Scan Git-visible files without printing possible credential values."""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    'OpenRouter token': re.compile(r'sk-or-[A-Za-z0-9_-]{24,}'),
    'GitHub token': re.compile(r'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})'),
    'AWS access key': re.compile(r'(?:AKIA|ASIA)[A-Z0-9]{16}'),
    'Private key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'Credential-bearing URL': re.compile(r'https?://[^\s/:]+:[^\s/@]+@'),
    'Personal absolute path': re.compile(r'/Users/[A-Za-z0-9._-]+/'),
}
DENIED = {'.venv', '.deps', 'jobs', 'qa', 'asset_library', 'models', '__pycache__'}

def scan(files):
    findings = []
    for name in files:
        path = Path(name)
        if set(path.parts) & DENIED or path.name.startswith('.env') or path.name == 'local-models.json' or path.suffix in {'.pem', '.key', '.safetensors', '.gguf', '.ckpt', '.pt', '.pth'}:
            findings.append({'file': name, 'type': 'Excluded runtime or credential file'})
            continue
        data = (ROOT / path).read_bytes()
        if b'\0' in data:
            findings.append({'file': name, 'type': 'Unexpected binary file; review before publishing'})
            continue
        text = data.decode('utf-8')
        for kind, pattern in PATTERNS.items():
            for match in pattern.finditer(text):
                findings.append({'file': name, 'line': text.count('\n', 0, match.start()) + 1, 'type': kind})
    return findings

if __name__ == '__main__':
    raw = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT)
    files = sorted({p for p in raw.decode().split('\0') if p and (ROOT / p).is_file()})
    findings = scan(files)
    print(json.dumps({'files_scanned': len(files), 'findings': findings}, indent=2))
    raise SystemExit(bool(findings))
