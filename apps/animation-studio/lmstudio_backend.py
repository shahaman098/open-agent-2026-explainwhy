"""LM Studio native API, fixed loopback address; no cloud endpoints or tools."""
import http.client
import json
import os
import queue
import socket
import threading
import time

HOST='127.0.0.1'
PORT=1234

class StudioError(RuntimeError):pass
class StudioCancelled(Exception):pass

def headers():
    result={'Content-Type':'application/json'}
    token=os.environ.get('ANIMATION_LMSTUDIO_TOKEN')
    if token:result['Authorization']='Bearer '+token
    return result

def request(method,path,data=None,timeout=10):
    conn=http.client.HTTPConnection(HOST,PORT,timeout=timeout)
    try:
        conn.request(method,path,body=json.dumps(data).encode() if data is not None else None,headers=headers())
        response=conn.getresponse();raw=response.read(16*1024**2)
        if response.status>=400:raise StudioError(f'LM Studio ({response.status}): '+raw.decode(errors='replace')[:1500])
        return json.loads(raw)
    except (OSError,http.client.HTTPException) as error:
        raise StudioError('LM Studio is unavailable. Start its local server on 127.0.0.1:1234. '+str(error)) from error
    finally:conn.close()

def models():return request('GET','/api/v1/models').get('models',[])

def find_model(key):
    for item in models():
        if item.get('key')==key:return item
    raise StudioError('This model is no longer available in LM Studio. Refresh the model list.')

def stream_chat(payload,cancel,on_event,timeout=3600):
    """Interrupt a blocked prefill/read by shutting down only this request's socket."""
    events=queue.Queue(maxsize=128);stopped=threading.Event();sockets=[]
    def put(item):
        while not stopped.is_set():
            try:events.put(item,timeout=.1);return
            except queue.Full:pass
    def read():
        conn=http.client.HTTPConnection(HOST,PORT,timeout=timeout)
        try:
            conn.connect();sockets.append(conn.sock)
            conn.request('POST','/api/v1/chat',json.dumps(payload).encode(),headers())
            response=conn.getresponse()
            if response.status>=400:raise StudioError(f'LM Studio ({response.status}): '+response.read(8192).decode(errors='replace'))
            if 'text/event-stream' not in (response.getheader('Content-Type') or ''):raise StudioError('LM Studio did not return an event stream.')
            lines=[]
            while not stopped.is_set():
                line=response.readline(4*1024**2)
                if not line:break
                line=line.decode().rstrip('\r\n')
                if line.startswith('data:'):lines.append(line[5:].lstrip())
                elif not line and lines:
                    put(('event',json.loads('\n'.join(lines))));lines=[]
            if lines:put(('event',json.loads('\n'.join(lines))))
            put(('end',None))
        except Exception as error:put(('error',str(error)))
        finally:conn.close()
    worker=threading.Thread(target=read,daemon=True);worker.start();start=time.monotonic();result=None
    try:
        while True:
            if cancel.is_set():raise StudioCancelled()
            if time.monotonic()-start>timeout:raise StudioError('LM Studio generation exceeded its time limit.')
            try:kind,data=events.get(timeout=.1)
            except queue.Empty:continue
            if kind=='error':raise StudioError(data)
            if kind=='end':
                if result is None:raise StudioError('LM Studio disconnected before completing the answer. The partial output is preserved.')
                return result
            if data.get('type')=='error':raise StudioError(str(data.get('error',{}).get('message','LM Studio generation failed.')))
            on_event(data)
            if data.get('type')=='chat.end':result=data.get('result')
    finally:
        stopped.set()
        for sock in sockets:
            try:sock.shutdown(socket.SHUT_RDWR)
            except OSError:pass
            sock.close()
        worker.join(timeout=2)
