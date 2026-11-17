# Private avatar motion production

Completed Fit Room GLB → authenticated queue → private Python worker → Blender body rig and wave → 5-second MP4 + editable project.

This pipeline makes **no image/video generation API calls**. It does not use Higgsfield. The existing Fit Room image/3D generation stages still use their existing providers and credits.

## Visual production desk

Run `py -3.14 dashboard.py --open` to open `http://127.0.0.1:8767` on the production computer. The dashboard binds only to loopback. It is not a public website or a remote administration endpoint.

- Real receiver heartbeat, last successful relay contact and local received-job counts.
- Actual stages: receiving, validating, rigging, applying motion, rendering, verifying and awaiting review. Rendering progress uses Blender's frame-write callback, not a timer.
- Inline MP4 playback, seeking and downloads for MP4, Blender and animated GLB.
- Start receiver, pause new claims after the current job, resume receiving and open the output folder.
- Synthetic QA sample shown separately and excluded from production counts.
- Host/Origin checks, a per-session control token, file allowlist and no raw secret/log endpoints. The browser never receives the production API secret or job leases.

The dashboard reads local job files; its counts are received jobs on this computer, **not the unclaimed cloud queue**. Pausing reception does not cancel or suspend a render already underway. Closing the browser does not stop the background receiver.

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

## Application intake and automatic motion handoff

A successful Fit Room email now transfers the generated front reference to the private relay using a seven-day signed capability tied to that exact image. The receiver saves it locally and shows `Waiting for 3D model`. Original source photos, contact details and written stories are not copied into this queue. References are chunked in private storage, limited by the generation capability, deduplicated per front generation and removed from the relay after seven days. Local production retention is 30 days.

The application includes explicit notice of the subsequent completed-model transfer. When its 3D model is ready in the same tab, Fit Room automatically enqueues it with the application identifier. The local worker claims only completed models. Existing manual model transfer remains available. No application operation starts a paid reference or 3D generation. Transfer failure has a separate retry that never resends the application email.

An application with only an image cannot produce articulated 3D motion. Its three remaining views and 3D reconstruction still require the studio consent and generation steps. Historical email applications need an operator recovery entry; they are not retrospectively treated as rendered jobs or complete models.
