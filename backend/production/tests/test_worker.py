import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import io

spec=importlib.util.spec_from_file_location('production_worker',Path(__file__).resolve().parents[1]/'worker.py')
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class SourceValidation(unittest.TestCase):
    def test_application_reference_is_saved_without_rendering(self):
        class Relay:
            def post(self,route,data):
                self.assert_route=route
                return {'jobs':[{'jobId':'app-reference-test','kind':'application','created':1794885600000,'height':180}]}
            def request(self,route,data):
                return io.BytesIO(b'\xff\xd8\xff\x00')
        with tempfile.TemporaryDirectory() as temp:
            worker.sync_intakes(Relay(),Path(temp))
            folder=Path(temp)/'app-reference-test'
            self.assertEqual(json.loads((folder/'progress.json').read_text())['stage'],'waiting_model')
            self.assertTrue((folder/'avatar-front.jpg').exists())
            self.assertFalse((folder/'preview.mp4').exists())
    def write_glb(self,path,document):
        content=json.dumps(document).encode()
        content+=b' '*((-len(content))%4)
        path.write_bytes(struct.pack('<5I',0x46546c67,2,20+len(content),len(content),0x4e4f534a)+content)

    def test_external_file_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'source.glb'
            for uri in ['file:///private.txt','https://attacker.test/image.png','../../private.txt']:
                self.write_glb(path,{'images':[{'uri':uri}]})
                with self.assertRaises(ValueError):worker.validate_glb(path)

    def test_embedded_model_valid(self):
        path=Path(__file__).resolve().parents[3]/'tests'/'avatar-fixture.glb'
        self.assertEqual(worker.validate_glb(path)['asset']['version'],'2.0')

    def test_no_insecure_remote_or_credential_url(self):
        for url in ['http://example.com','https://user:pass@example.com','https://example.com/path','https://example.com?key=secret']:
            with self.assertRaises(ValueError):worker.Relay(url,'secret')


if __name__=='__main__':unittest.main()
