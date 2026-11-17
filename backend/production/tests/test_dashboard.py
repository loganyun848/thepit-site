import importlib.util
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import urllib.request
import urllib.error

MODULE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(MODULE))
import dashboard


class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        root=Path(self.temp.name)
        self.jobs=root/'jobs';self.jobs.mkdir()
        sample=root/'QA_Sample';sample.mkdir()
        (sample/'preview.mp4').write_bytes(b'0123456789')
        (sample/'video-verification.json').write_text(json.dumps({'duration':5,'fps':24,'frames':120}))
        self.app=dashboard.Dashboard({'PRODUCTION_OUTPUT':str(self.jobs),'PRODUCTION_KEY':'PRIVATE-DO-NOT-RETURN','FAL_KEY':'PRIVATE-DO-NOT-RETURN'})
        self.server=ThreadingHTTPServer(('127.0.0.1',0),dashboard.handler_for(self.app,0))
        self.port=self.server.server_port
        self.server.RequestHandlerClass=dashboard.handler_for(self.app,self.port)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.base=f'http://127.0.0.1:{self.port}'

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()

    def request(self,path,headers=None,body=None):
        req=urllib.request.Request(self.base+path,headers=headers or {},data=body)
        try:response=urllib.request.urlopen(req)
        except urllib.error.HTTPError as error:response=error
        self.addCleanup(response.close)
        return response

    def test_live_snapshot_separates_sample_and_omits_secrets(self):
        with self.request('/api/status') as response:
            text=response.read().decode();data=json.loads(text)
        self.assertNotIn('PRIVATE-DO-NOT-RETURN',text)
        self.assertEqual(data['jobs'],[])
        self.assertTrue(data['sample']['fixture'])
        self.assertTrue(data['sample']['verified'])

    def test_host_origin_and_control_tokens(self):
        self.assertEqual(self.request('/api/status',{'Host':'evil.example'}).status,403)
        self.assertEqual(self.request('/api/status',{'Origin':'https://evil.example'}).status,403)
        self.assertEqual(self.request('/api/control',body=b'{"action":"pause"}').status,403)
        self.assertEqual(self.request('/api/control',{'X-Dashboard-Token':self.app.token},b'{"action":"delete"}').status,400)

    def test_media_range_and_private_file_denial(self):
        with self.request('/media/qa-sample/preview.mp4',{'Range':'bytes=3-6'}) as response:
            self.assertEqual(response.status,206);self.assertEqual(response.read(),b'3456')
        self.assertEqual(self.request('/media/qa-sample/preview.mp4',{'Range':'bytes=200-400'}).status,416)
        self.assertEqual(self.request('/media/qa-sample/private-job.json').status,404)
        self.assertEqual(self.request('/.env').status,404)
        self.assertEqual(self.request('/media/qa-sample/../../.env').status,404)

    def test_corrupt_partial_metadata_does_not_claim_success(self):
        folder=self.jobs/'sample-job-123';folder.mkdir()
        (folder/'video-verification.json').write_text('{"duration":5')
        (folder/'private-job.json').write_text('{"lease":"SECRET-LEASE","jobId":"sample-job-123"}')
        value=self.app.snapshot()
        self.assertFalse(value['jobs'][0]['verified'])
        self.assertNotIn('SECRET-LEASE',json.dumps(value))


if __name__=='__main__':unittest.main()
