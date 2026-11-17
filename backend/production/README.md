# Private avatar motion production

Completed Fit Room GLB → authenticated queue → private Python worker → Blender body rig and wave → 5-second MP4 + editable project.

This pipeline makes **no image/video generation API calls**. It does not use Higgsfield. The existing Fit Room image/3D generation stages still use their existing providers and credits.

## Operator workflow

1. Start `start-worker.ps1` on the production workstation. Keep the workstation awake and connected. The worker makes outbound HTTPS requests only; no router ports or public local server are needed.
2. Complete a 3D avatar in Fit Room. Rotate it to face forward, click **Set this direction as front**, and set its project height.
3. In **Motion preview**, consent to the separate transfer and click **Send for a 5-second preview**. No model or personal data is transferred into production merely by opening this section.
4. The workstation claims the job, downloads the model and creates the preview. Fit Room displays queued / processing / needs review status. A model can be submitted only once through this route.
5. Review the local output before delivery or publication. The website does not host or publicly expose the MP4.

## Installation

- Python 3.14 (standard library only).
- Blender 4.5 LTS, official portable distribution.
- Standard FFprobe with software H.264 decoding. Some vendor-modified builds select unavailable hardware decoders and cannot verify frame counts.
- Copy `.env.example` to `.env`. Set executable paths and a private `PRODUCTION_OUTPUT` directory if desired.
- Generate an operator secret; store the same value in local `PRODUCTION_KEY` and the Cloudflare Worker secret named `PRODUCTION_KEY`. Never place it in `config.js`, HTML, a URL or source control.
- Deploy `backend/tryon/wrangler.jsonc`, including migration `v2-motion`, to create the production Durable Object binding. Existing AI keys and the quota database are preserved.

Start:

```powershell
py -3.14 worker.py --watch
```

One queue check, or resume an interrupted job without another AI request:

```powershell
py -3.14 worker.py
py -3.14 worker.py --resume JOB_ID
```

Process a previously downloaded model locally (front rotation is radians):

```powershell
py -3.14 worker.py --local C:\Private\avatar.glb --height 180 --yaw 0
```

## Output per job

| File | Purpose |
| --- | --- |
| `source.glb` | Original downloaded model |
| `motion.blend` | Packed materials, 19-bone body rig, wave keyframes, lights and camera |
| `animated.glb` | Skinned model and animation for other production tools |
| `preview.mp4` | 120 frames, 24 fps, exactly 5 seconds; default 720 × 720 |
| `rig-landmarks.json` | Estimated rest-pose bone anchors in meters |
| `render-audit.json` | Count of moving vertices, displacement and return-to-rest check |
| `video-verification.json` | Decoded frame count, duration, file size and SHA-256 |
| `render.log` | Private Blender diagnostics |
| `private-job.json` | Private job receipt and lease; do not share |

## Motion and limitations

`wave-v1`: neutral A-pose → raise the avatar's right arm → wave → return to rest. Frame range 1–120 at 24 fps. The camera remains fixed; movement comes from skin deformation driven by an armature.

The local fitter estimates joint anchors from the aligned mesh and applies Blender bone-heat skin weights. Project height scales the mesh; it does not recover true anatomical measurements. This is a **review preview**, not a film-ready automatic character rig. No face, lip-sync or individual finger rig is included. Fused limbs, wide skirts, bulky clothing, incorrect front alignment and non-humanoid meshes can require manual work. Models with an existing armature are rejected rather than overwriting their rig. Unweighted meshes and outputs without actual vertex movement are rejected.

The program saves a `.blend` for correcting bones and weights before further rendering. Do not describe preview validation as validation of identity, anatomy, natural motion or cinematic quality.

## Privacy and resilience

- Source URLs are derived only from verified existing model jobs, not client-supplied arbitrary URLs.
- A public receipt reads only its own job status. Internal claim, download and completion require the operator secret plus a matching lease.
- Model download redirects and external GLB resources are rejected; Blender auto-execution is disabled.
- Queue metadata expires after seven days. Source links usually expire within two hours of model submission, so the workstation should be online during transfer. Expired links are not silently regenerated.
- Local queued-job files are purged after 30 days on the next worker iteration. The worker must run to enforce local deletion. Local manually imported projects are operator-managed.
- A heartbeat renews the lease during rendering. An interrupted job is not reassigned automatically; use `--resume` to avoid duplicate work.
- Finished videos await human review. Sending a production job does not send an application email or publish media.
- Keep `.env` and `runtime/` private; both are ignored by Git. No photos, model buffers, queue receipts or credentials are stored in browser local storage.

## Validation

The repository includes a clearly marked synthetic mannequin and its construction script for reproducible tests. Synthetic QA media is never represented as a real user's avatar.

```powershell
node --test tests/production.test.mjs backend/tryon/tests/production-ui.test.mjs backend/tryon/tests/production-runtime.test.cjs
py -3.14 -m unittest discover -s backend/production/tests -v
py -3.14 backend/production/worker.py --local tests/motion-fixture.glb --fixture
```
