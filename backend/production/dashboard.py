"""Loopback-only operator dashboard for the private motion receiver.

Run: py -3.14 dashboard.py --open
The dashboard never exposes secrets or provides arbitrary file access.
"""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit, unquote
import webbrowser

import worker

ROOT=Path(__file__).resolve().parent
STATIC=ROOT/'dashboard'
FILES={'preview.mp4','motion.blend','animated.glb','source.glb','contact.png','avatar-front.jpg'}
STAGES={'waiting_model','receiving','validating','rigging','animating','rendering','verifying','reporting','ready','failed','delivery_pending'}


def read_json(path):
    try:
        if path.stat().st_size>100000:
            return {}
        value=json.loads(path.read_text(encoding='utf-8-sig'))
        return value if isinstance(value,dict) else {}
    except (OSError,ValueError):
        return {}


class Dashboard:
    def __init__(self,settings=None):
        self.settings=settings if settings is not None else worker.config()
        self.output=Path(self.settings.get('PRODUCTION_OUTPUT',str(ROOT/'runtime'/'jobs'))).resolve()
        self.sample=self.output.parent/'QA_Sample'
        self.token=secrets.token_urlsafe(32)
        self.control_lock=threading.Lock()

    def directory(self,identity):
        if identity=='qa-sample':
            folder=self.sample
        else:
            if not worker.ID_PATTERN.fullmatch(identity):
                raise ValueError('Unknown job.')
            folder=self.output/identity
        if folder.is_symlink() or not folder.is_dir():
            raise ValueError('Unknown job.')
        if folder.resolve().parent not in (self.output,self.output.parent):
            raise ValueError('Unknown job.')
        return folder

    def job(self,folder,identity=None):
        identity=identity or folder.name
        manifest=read_json(folder/'job.json')
        private=read_json(folder/'private-job.json')
        progress=read_json(folder/'progress.json')
        result=read_json(folder/'video-verification.json')
        audit=read_json(folder/'render-audit.json')
        error=read_json(folder/'error.json')
        intake=read_json(folder/'intake.json')
        files=[name for name in sorted(FILES) if (folder/name).is_file() and not (folder/name).is_symlink()]
        verified=result.get('frames')==120 and result.get('fps')==24 and result.get('duration')==5 and 'preview.mp4' in files
        stage=progress.get('stage')
        if stage not in STAGES:
            stage='ready' if verified else 'failed' if error else 'receiving'
        return {'id':identity,'stage':stage,'modelId':intake.get('modelId'),'fixture':identity=='qa-sample' or manifest.get('fixture') is True or audit.get('fixture') is True,
            'createdAt':private.get('created',folder.stat().st_ctime*1000)/1000,
            'updatedAt':progress.get('updatedAt',folder.stat().st_mtime),'frame':max(0,min(120,int(progress.get('frame',120 if verified else 0)))),
            'totalFrames':120,'verified':verified,'files':files,'height':manifest.get('height',private.get('height')),
            'metrics':{'duration':result.get('duration'),'fps':result.get('fps'),'frames':result.get('frames'),'bones':audit.get('bone_count'),'movingVertices':audit.get('animated_vertices')},
            'message':progress.get('message') if stage=='waiting_model' else 'Inspect the local render log; this model requires attention.' if error and stage!='ready' else None}

    def snapshot(self):
        state=read_json(ROOT/'runtime'/'worker-status.json')
        online=bool(state and time.time()-state.get('heartbeat',0)<12 and state.get('mode')!='stopped')
        jobs=[]
        if self.output.is_dir():
            for folder in self.output.iterdir():
                if folder.is_dir() and not folder.is_symlink() and worker.ID_PATTERN.fullmatch(folder.name):
                    try:jobs.append(self.job(folder))
                    except (OSError,ValueError,TypeError):continue
        present={j['id'] for j in jobs}
        jobs=[j for j in jobs if not j.get('modelId') or j['modelId'] not in present]
        jobs.sort(key=lambda j:j['createdAt'],reverse=True)
        for job in jobs:
            if job['stage'] in {'receiving','validating','rigging','animating','rendering','verifying','reporting'} and time.time()-job['updatedAt']>30 and (not online or state.get('jobId')!=job['id']):
                job['stage']='interrupted'
                job['message']='The receiver is no longer processing this job. Inspect the saved files before resuming.'
        sample=self.job(self.sample,'qa-sample') if self.sample.is_dir() and not self.sample.is_symlink() else None
        mode=state.get('mode','offline') if online else 'offline'
        return {'worker':{'online':online,'mode':mode,'jobId':state.get('jobId') if online else None,
            'lastContact':state.get('lastContact'),'startedAt':state.get('startedAt'),'heartbeat':state.get('heartbeat'),
            'pausedRequested':worker.pause_requested(),'connection':state.get('connection') if online else None},
            'jobs':jobs,'sample':sample,'updatedAt':time.time(),'csrfToken':self.token,
            'setup':{'blender':Path(self.settings.get('BLENDER_PATH','')).is_file(),'videoCheck':Path(self.settings.get('FFPROBE_PATH','')).is_file(),'relay':bool(self.settings.get('PRODUCTION_ENDPOINT') and self.settings.get('PRODUCTION_KEY'))}}

    def control(self,action):
        if action not in ('start','pause','resume','open-folder'):
            raise ValueError('Unknown action.')
        with self.control_lock:
            if action=='open-folder':
                self.output.mkdir(parents=True,exist_ok=True)
                if os.name=='nt':os.startfile(self.output)
                return 'Output folder opened.'
            (ROOT/'runtime').mkdir(exist_ok=True)
            worker.atomic_json(ROOT/'runtime'/'control.json',{'paused':action=='pause'})
            if action=='pause':return 'New jobs will pause after the current job finishes.'
            try:handle=worker.single_worker_lock()
            except RuntimeError:return 'Receiver is already running. New jobs are enabled.'
            else:handle.close()
            with (ROOT/'runtime'/'receiver-output.log').open('a',encoding='utf-8') as out,(ROOT/'runtime'/'receiver-error.log').open('a',encoding='utf-8') as err:
                process=subprocess.Popen([sys.executable,'-u',str(ROOT/'worker.py'),'--watch'],cwd=ROOT,stdout=out,stderr=err,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            worker.atomic_json(ROOT/'runtime'/'receiver-process.json',{'pid':process.pid})
            return 'Receiver starting. Waiting for a live heartbeat.'


def handler_for(app,port):
    allowed_hosts={f'127.0.0.1:{port}',f'localhost:{port}'}
    allowed_origins={'http://'+host for host in allowed_hosts}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass

        def trusted(self):
            return self.headers.get('Host') in allowed_hosts and self.headers.get('Origin') in (None,*allowed_origins) and self.headers.get('Sec-Fetch-Site') not in ('cross-site','same-site')

        def headers_for(self,status,mime,length,extra=None):
            self.send_response(status)
            for name,value in {'Content-Type':mime,'Content-Length':str(length),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
                'Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",**(extra or {})}.items():
                self.send_header(name,value)
            self.end_headers()

        def json(self,data,status=200):
            content=json.dumps(data).encode()
            self.headers_for(status,'application/json',len(content))
            if self.command!='HEAD':self.wfile.write(content)

        def do_GET(self):
            if not self.trusted():return self.json({'error':'Local dashboard access only.'},403)
            url=urlsplit(self.path)
            try:
                if url.path=='/api/status':return self.json(app.snapshot())
                static={'/':'index.html','/dashboard.css':'dashboard.css','/dashboard.js':'dashboard.js'}
                if url.path in static:
                    path=STATIC/static[url.path];content=path.read_bytes()
                    mime={'/':'text/html; charset=utf-8','/dashboard.css':'text/css','/dashboard.js':'text/javascript'}[url.path]
                    self.headers_for(200,mime,len(content))
                    if self.command!='HEAD':self.wfile.write(content)
                    return
                match=re.fullmatch(r'/media/([A-Za-z0-9_-]{8,100})/([A-Za-z0-9_.-]+)',unquote(url.path))
                if not match or match[2] not in FILES:return self.json({'error':'File not found.'},404)
                folder=app.directory(match[1]);path=folder/match[2]
                if path.is_symlink() or not path.is_file() or path.resolve().parent!=folder.resolve():return self.json({'error':'File not found.'},404)
                size=path.stat().st_size;start,end=0,size-1;status=200
                request_range=self.headers.get('Range')
                if request_range:
                    byte_range=re.fullmatch(r'bytes=(\d*)-(\d*)',request_range)
                    if not byte_range or not any(byte_range.groups()):return self.json({'error':'Invalid range.'},416)
                    a,b=byte_range.groups()
                    start=int(a) if a else max(0,size-int(b))
                    end=min(size-1,int(b)) if a and b else size-1
                    if start>end or start>=size:
                        self.headers_for(416,'application/octet-stream',0,{'Content-Range':f'bytes */{size}'});return
                    status=206
                extra={'Accept-Ranges':'bytes'}
                if status==206:extra['Content-Range']=f'bytes {start}-{end}/{size}'
                if url.query=='download=1':extra['Content-Disposition']=f'attachment; filename="{path.name}"'
                mime=mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
                self.headers_for(status,mime,end-start+1,extra)
                if self.command=='HEAD':return
                with path.open('rb') as file:
                    file.seek(start);remaining=end-start+1
                    while remaining:
                        chunk=file.read(min(1024*1024,remaining))
                        if not chunk:break
                        self.wfile.write(chunk);remaining-=len(chunk)
            except (BrokenPipeError,ConnectionResetError):pass
            except (OSError,ValueError,TypeError):self.json({'error':'The requested local resource is unavailable.'},404)

        def do_HEAD(self):self.do_GET()

        def do_POST(self):
            if not self.trusted() or not secrets.compare_digest(self.headers.get('X-Dashboard-Token',''),app.token):return self.json({'error':'Invalid local dashboard request.'},403)
            if self.path!='/api/control':return self.json({'error':'Not found.'},404)
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<1024:raise ValueError()
                data=json.loads(self.rfile.read(length))
                if not isinstance(data,dict):raise ValueError()
                return self.json({'ok':True,'message':app.control(data.get('action'))})
            except (ValueError,TypeError):return self.json({'error':'Invalid action.'},400)
            except OSError:return self.json({'error':'The receiver could not start. Check its local configuration.'},503)

    return Handler


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8767)
    parser.add_argument('--open',action='store_true')
    args=parser.parse_args()
    app=Dashboard()
    try:server=ThreadingHTTPServer(('127.0.0.1',args.port),handler_for(app,args.port))
    except OSError:
        print('Dashboard port is already in use. Open the existing dashboard or choose another port.')
        return
    print(f'Production dashboard: http://127.0.0.1:{args.port}',flush=True)
    if args.open:webbrowser.open(f'http://127.0.0.1:{args.port}')
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()


if __name__=='__main__':main()
