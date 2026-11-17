"""Private Fit Room -> Blender production worker. Standard library only.

No generative API calls. No inbound port. Secrets remain on the operator's PC.
Run --watch for new jobs, --resume ID after interruption, or --local MODEL.glb.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
MAX_MODEL = 100 * 1024 * 1024
ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{8,100}$")


def single_worker_lock():
    directory=ROOT/'runtime'
    directory.mkdir(parents=True,exist_ok=True)
    handle=(directory/'worker.lock').open('a+b')
    try:
        handle.seek(0,2)
        if handle.tell()==0:
            handle.write(b'0');handle.flush()
        handle.seek(0)
        if os.name=='nt':
            import msvcrt
            msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        return handle
    except OSError:
        handle.close()
        raise RuntimeError('A production worker is already running. Stop it before opening another worker.') from None


def atomic_json(path, data):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, indent=2), encoding='utf-8')
    temp.replace(path)


def config():
    result = dict(os.environ)
    path = ROOT / '.env'
    if path.exists():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            if line.strip() and not line.lstrip().startswith('#'):
                name, sep, value = line.partition('=')
                if sep and name.strip() not in result:
                    result[name.strip()] = value.strip()
    return result


def validate_glb(path):
    size = path.stat().st_size
    if size < 28 or size > MAX_MODEL:
        raise ValueError('Invalid model size (maximum 100 MB).')
    with path.open('rb') as file:
        magic, version, total, length, chunk = struct.unpack('<5I', file.read(20))
        if (magic, version, total, chunk) != (0x46546C67, 2, size, 0x4E4F534A) or length > min(size-20, 8*1024*1024):
            raise ValueError('Invalid GLB header.')
        doc = json.loads(file.read(length))
    # A model cannot load network resources, local files or executable scripts.
    for item in doc.get('images', []) + doc.get('buffers', []):
        uri = item.get('uri', '')
        if uri and not re.fullmatch(r'data:(image/(png|jpeg|webp)|application/octet-stream);base64,[A-Za-z0-9+/=]+', uri):
            raise ValueError('Only embedded GLB resources are accepted.')
    return doc


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Relay:
    def __init__(self, endpoint, secret):
        parsed = urllib.parse.urlsplit(endpoint)
        local = parsed.hostname in ('127.0.0.1', 'localhost')
        if (parsed.scheme != 'https' and not (parsed.scheme == 'http' and local)) or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
            raise ValueError('Use an HTTPS worker origin (localhost allowed for tests).')
        if not secret:
            raise ValueError('PRODUCTION_KEY is missing.')
        self.endpoint, self.secret = endpoint.rstrip('/'), secret
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, route, data):
        req = urllib.request.Request(self.endpoint + '/production/' + route,
            data=json.dumps(data).encode(), headers={'Content-Type': 'application/json', 'Accept': 'application/json, model/gltf-binary', 'User-Agent':'THE-PIT-Production/1.0', 'Authorization': 'Bearer ' + self.secret}, method='POST')
        try:
            return self.opener.open(req, timeout=120)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'Production {route} rejected (HTTP {error.code}).') from None

    def post(self, route, data):
        with self.request(route, data) as response:
            result = json.load(response)
        if not result.get('ok'):
            raise RuntimeError(f'Production {route} failed.')
        return result

    def download(self, job, path):
        partial = path.with_suffix('.part')
        try:
            total = 0
            with self.request('source', {'id': job['jobId'], 'lease': job['lease']}) as response, partial.open('wb') as file:
                while chunk := response.read(1024*1024):
                    total += len(chunk)
                    if total > MAX_MODEL:
                        raise ValueError('Model exceeds 100 MB.')
                    file.write(chunk)
            validate_glb(partial)
            partial.replace(path)
        finally:
            partial.unlink(missing_ok=True)


def heartbeat(relay, job, stop):
    while not stop.wait(40):
        try:
            relay.post('heartbeat', {'id': job['jobId'], 'lease': job['lease']})
        except Exception:
            print('Status connection interrupted; local processing continues.', flush=True)


def inspect_video(ffprobe, path):
    result = subprocess.run([ffprobe, '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
        'stream=nb_read_frames,r_frame_rate,width,height:format=duration', '-of', 'json', str(path)],
        check=True, capture_output=True, text=True, timeout=60)
    data = json.loads(result.stdout)
    stream = data['streams'][0]
    if int(stream['nb_read_frames']) != 120 or stream['r_frame_rate'] != '24/1' or abs(float(data['format']['duration']) - 5) > .02:
        raise ValueError('Video must contain exactly 120 frames at 24 fps (5 seconds).')
    return {'duration': 5, 'fps': 24, 'frames': 120, 'bytes': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def render(job, directory, settings):
    source = directory / 'source.glb'
    validate_glb(source)
    manifest = {'schema': 'thepit-motion-v1', 'jobId': job['jobId'], 'height': job['height'],
        'yaw': job['yaw'], 'action': 'wave-v1', 'fps': 24, 'frames': 120, 'source': str(source),
        'output': str(directory), 'fixture': bool(job.get('fixture')), 'resolution': int(settings.get('RENDER_RESOLUTION', '720'))}
    atomic_json(directory / 'job.json', manifest)
    command = [settings['BLENDER_PATH'], '--background', '--factory-startup', '--disable-autoexec',
        '--python-exit-code', '1', '--python', str(ROOT / 'render_motion.py'), '--', str(directory / 'job.json')]
    render_env = dict(os.environ)
    render_env['BLENDER_USER_RESOURCES'] = str(ROOT / 'runtime' / 'blender-user')
    render_env['BLENDER_USER_CONFIG'] = str(ROOT / 'runtime' / 'blender-user' / 'config')
    Path(render_env['BLENDER_USER_CONFIG']).mkdir(parents=True, exist_ok=True)
    with (directory / 'render.log').open('w', encoding='utf-8') as log:
        subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=1800, env=render_env)
    video = directory / 'preview.mp4'
    result = inspect_video(settings['FFPROBE_PATH'], video)
    audit = json.loads((directory / 'render-audit.json').read_text(encoding='utf-8'))
    if audit.get('animated_vertices', 0) < 20 or audit.get('max_displacement_m', 0) < .03:
        raise ValueError('Body deformation was not verified; no successful output is reported.')
    result['quality'] = 'NEEDS_REVIEW'
    atomic_json(directory / 'video-verification.json', result)
    return result


def process(relay, job, output, settings):
    identity = job['jobId']
    if not ID_PATTERN.fullmatch(identity):
        raise ValueError('Invalid job ID.')
    directory = output / identity
    directory.mkdir(parents=True, exist_ok=True)
    atomic_json(directory / 'private-job.json', job)  # Lease is private, never committed.
    stop = threading.Event()
    thread = threading.Thread(target=heartbeat, args=(relay, job, stop), daemon=True)
    thread.start()
    try:
        relay.post('heartbeat', {'id': identity, 'lease': job['lease']})
        if not (directory / 'source.glb').exists():
            relay.download(job, directory / 'source.glb')
        marker = directory / 'video-verification.json'
        if marker.exists() and (directory / 'preview.mp4').exists():
            result = inspect_video(settings['FFPROBE_PATH'], directory / 'preview.mp4')
        else:
            result = render(job, directory, settings)
        # A failed status update can be resumed without downloading or rendering again.
        atomic_json(directory / 'delivery-pending.json', result)
        relay.post('finish', {'id': identity, 'lease': job['lease'], 'status': 'NEEDS_REVIEW', 'result': result})
        (directory / 'delivery-pending.json').unlink(missing_ok=True)
        print(f'{identity}: 5-second video and Blender project ready for review.', flush=True)
    except Exception as error:
        atomic_json(directory / 'error.json', {'type': type(error).__name__, 'message': str(error), 'at': time.time()})
        # Do not lose a completed render just because the relay is temporarily offline.
        if not (directory / 'delivery-pending.json').exists():
            try:
                relay.post('finish', {'id': identity, 'lease': job['lease'], 'status': 'FAILED'})
            except Exception:
                pass
        raise
    finally:
        stop.set()
        thread.join(timeout=2)


def purge(output):
    """Enforce 30-day local retention, only inside the configured job directory."""
    root = output.resolve()
    for directory in root.iterdir():
        manifest = directory / 'private-job.json'
        if directory.is_symlink() or not directory.is_dir() or not ID_PATTERN.fullmatch(directory.name) or not manifest.is_file():
            continue
        job = json.loads(manifest.read_text(encoding='utf-8'))
        if time.time()*1000 - job.get('created', time.time()*1000) > 30*86400000:
            target = directory.resolve()
            if target.parent == root:
                shutil.rmtree(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--watch', action='store_true')
    modes.add_argument('--resume', metavar='JOB_ID')
    modes.add_argument('--local', type=Path, metavar='MODEL.glb')
    parser.add_argument('--height', type=float, default=180)
    parser.add_argument('--yaw', type=float, default=0, help='Front rotation in radians, matching Fit Room')
    parser.add_argument('--fixture', action='store_true', help='Mark a local synthetic QA model')
    args = parser.parse_args()
    settings = config()
    worker_lock = single_worker_lock()
    for name in ('BLENDER_PATH', 'FFPROBE_PATH'):
        if not Path(settings.get(name, '')).is_file():
            parser.error(f'Set {name} in backend/production/.env.')
    output = Path(settings.get('PRODUCTION_OUTPUT', str(ROOT / 'runtime' / 'jobs'))).resolve()
    output.mkdir(parents=True, exist_ok=True)
    purge(output)
    if args.local:
        if not 80 <= args.height <= 250 or not -6.284 <= args.yaw <= 6.284:
            parser.error('Invalid height or front rotation.')
        identity = 'local-' + str(time.time_ns())
        directory = output / identity
        directory.mkdir()
        shutil.copyfile(args.local, directory / 'source.glb')
        render({'jobId': identity, 'height': args.height, 'yaw': args.yaw, 'fixture': args.fixture}, directory, settings)
        print(directory)
        return
    relay = Relay(settings.get('PRODUCTION_ENDPOINT', ''), settings.get('PRODUCTION_KEY', ''))
    if args.resume:
        if not ID_PATTERN.fullmatch(args.resume):
            parser.error('Invalid job ID.')
        job = json.loads((output / args.resume / 'private-job.json').read_text(encoding='utf-8'))
        process(relay, job, output, settings)
        return
    print('Production worker ready. Waiting for completed avatars.', flush=True)
    while True:
        try:
            purge(output)
            job = relay.post('claim', {})['job']
            if job:
                print(f"{job['jobId']}: source received; preparing wave preview.", flush=True)
                process(relay, job, output, settings)
            elif not args.watch:
                print('No pending jobs.')
        except Exception as error:
            print(f'Worker paused for this job: {type(error).__name__}. Inspect the private local log.', flush=True)
            if not args.watch:
                raise
        if not args.watch:
            break
        time.sleep(10)


if __name__ == '__main__':
    main()
