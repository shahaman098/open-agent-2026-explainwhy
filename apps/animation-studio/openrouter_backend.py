"""OpenRouter inference backend. Credentials never enter job files or browser storage."""
import http.client
import json
import os
import queue
import socket
import threading
import time

HOST='openrouter.ai'
MODEL_ID='deepseek/deepseek-v4.1-flash-1017'
_override=None
_lock=threading.RLock()

class RouterError(RuntimeError):pass
class RouterCancelled(Exception):pass

def get_key():
    with _lock:return os.environ.get('OPENROUTER_API_KEY','') if _override is None else _override

def key_status():
    return {'configured':bool(get_key()),'source':'environment' if _override is None and get_key() else 'session' if get_key() else None}

def set_key(value):
    global _override
    if not isinstance(value,str) or not value.startswith('sk-or-') or not 24<=len(value)<=1024 or any(c.isspace() for c in value):
        raise ValueError('Enter a valid OpenRouter API key in this field.')
    with _lock:_override=value

def clear_key():
    global _override
    with _lock:_override=''

def redact(message,key=None):return str(message).replace(key or get_key() or '\x00','[redacted]')

def connection(timeout=30):return http.client.HTTPSConnection(HOST,443,timeout=timeout)

def headers(key):return {'Content-Type':'application/json','Authorization':'Bearer '+key,'X-Title':'Animation Studio'}

def verify_key(value=None):
    key=value if value is not None else get_key()
    if not key:raise RouterError('Add your OpenRouter API key to connect this model.')
    conn=connection()
    try:
        conn.request('GET','/api/v1/key',headers=headers(key));response=conn.getresponse();raw=response.read(65536)
        if response.status>=400:raise RouterError('OpenRouter rejected the API key. Check it on the OpenRouter Keys page.')
        json.loads(raw)
        return {'valid':True}
    except (OSError,http.client.HTTPException,ValueError) as error:raise RouterError(redact(error,key)) from None
    finally:conn.close()

def stream_chat(payload,cancel,on_event,timeout=300):
    key=get_key()
    if not key:raise RouterError('Add your OpenRouter API key to connect this model.')
    events=queue.Queue(maxsize=128);stopped=threading.Event();sockets=[]
    def put(item):
        while not stopped.is_set():
            try:events.put(item,timeout=.1);return
            except queue.Full:pass
    def read():
        conn=connection()
        try:
            conn.connect();sockets.append(conn.sock)
            if stopped.is_set():return
            conn.sock.settimeout(timeout)
            conn.request('POST','/api/v1/chat/completions',json.dumps(payload).encode(),headers(key))
            response=conn.getresponse()
            if response.status>=400:raise RouterError(f'OpenRouter ({response.status}): '+redact(response.read(8192).decode(errors='replace'),key))
            if 'text/event-stream' not in (response.getheader('Content-Type') or ''):raise RouterError('OpenRouter did not return a stream.')
            while not stopped.is_set():
                line=response.readline(4*1024**2)
                if not line:break
                if not line.startswith(b'data:'):continue
                raw=line[5:].strip()
                if raw==b'[DONE]':put(('done',None));return
                if raw:put(('event',json.loads(raw)))
            put(('error','OpenRouter disconnected before completing the response. Partial output is preserved.'))
        except Exception as error:put(('error',redact(error,key)))
        finally:conn.close()
    worker=threading.Thread(target=read,daemon=True);worker.start();start=time.monotonic()
    try:
        while True:
            if cancel.is_set():raise RouterCancelled()
            if time.monotonic()-start>timeout:raise RouterError('OpenRouter request exceeded the 5-minute request limit. Partial output is preserved.')
            try:kind,data=events.get(timeout=.1)
            except queue.Empty:continue
            if kind=='done':return
            if kind=='error':raise RouterError(data)
            if data.get('error'):raise RouterError(redact(data['error'].get('message','OpenRouter generation failed.'),key))
            on_event(data)
    finally:
        stopped.set()
        for sock in sockets:
            try:sock.shutdown(socket.SHUT_RDWR)
            except OSError:pass
            sock.close()
        worker.join(timeout=2)
