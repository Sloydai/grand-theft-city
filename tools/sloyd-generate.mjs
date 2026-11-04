// Generates 3D models with the Sloyd public API (https://api.sloyd.ai/api) and saves them to
// models/<name>.glb for the game. Usage:
//   node tools/sloyd-generate.mjs [jobs file]        (default: tools/sloyd-jobs.json)
// Jobs: [{ name, prompt, faces?, texture? }] (text-to-3D), [{ name, image, ... }] (image-to-3D,
// a local image path) or [{ name, images: { front, left, back } }] (multi-image-to-3D). Models already in models/ are skipped unless --force.
// The API key comes from .env (SLOYD_CLIENT_ID, SLOYD_CLIENT_SECRET), never from the command
// line or the repo; each job costs API credits (see the Sloyd API dashboard).
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const env = Object.fromEntries((fs.existsSync(`${root}.env`) ? fs.readFileSync(`${root}.env`, 'utf8') : '').split('\n').map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const id = env.SLOYD_CLIENT_ID, secret = env.SLOYD_CLIENT_SECRET;
if (!id || !secret) throw new Error('Put SLOYD_CLIENT_ID and SLOYD_CLIENT_SECRET in .env at the repo root (see .env.example; keys from the Sloyd API dashboard).');
const API = env.SLOYD_API || 'https://api.sloyd.ai/api', headers = { 'x-client-id': id, 'x-client-secret': secret };
const jobs = JSON.parse(fs.readFileSync(process.argv.find((a) => a.endsWith('.json')) || `${root}tools/sloyd-jobs.json`, 'utf8'));
const force = process.argv.includes('--force');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(job) {
  // Several views of one object ({ front, left, back, right }: local image paths; front and at
  // least one other) for multi-image-to-3D, which follows the reference's shape closely.
  if (job.images) {
    const form = new FormData();
    for (const [view, file] of Object.entries(job.images)) form.append(`${view}Image`, new Blob([fs.readFileSync(path.resolve(root, file))], { type: 'image/jpeg' }), path.basename(file));
    form.append('FaceCount', String(job.faces ?? 60000));
    form.append('EnablePBR', 'true');
    return post('jobs/multi-image-to-3d', form);
  }
  if (job.image) {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(path.resolve(root, job.image))]), path.basename(job.image));
    form.append('targetFaceCount', String(job.faces ?? 30000));
    form.append('textureResolution', job.texture ?? '1k');
    form.append('topology', 'triangles');
    return post('jobs/image-to-3d', form);
  }
  return post('jobs/text-to-3d', JSON.stringify({ prompt: job.prompt, targetFaceCount: job.faces ?? 30000, textureResolution: job.texture ?? '1k', topology: 'triangles' }), { 'Content-Type': 'application/json' });
}
async function post(route, body, extra = {}) {
  const res = await fetch(`${API}/${route}`, { body, headers: { ...headers, ...extra }, method: 'POST' });
  if (!res.ok) throw new Error(`${route}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).jobId;
}
async function finish(jobId) {
  for (;;) {
    await sleep(5000);
    const res = await fetch(`${API}/jobs/${jobId}`, { headers });
    if (!res.ok) throw new Error(`job ${jobId}: HTTP ${res.status}`);
    const job = await res.json();
    if (job.status === 'success') return;
    if (job.status === 'error') throw new Error(`job ${jobId} failed: ${job.error || 'unknown error'}`);
  }
}

// At most 4 at a time (the API allows 5 concurrent jobs per key).
const queue = jobs.filter((j) => force || !fs.existsSync(`${root}models/${j.name}.glb`));
console.log(`${queue.length} of ${jobs.length} models to generate`);
async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    try {
      const jobId = await start(job);
      console.log(`${job.name}: job ${jobId}`);
      await finish(jobId);
      const glb = await fetch(`https://storage.googleapis.com/ai-services-quality/jobs/${jobId}.glb`);
      if (!glb.ok) throw new Error(`download: HTTP ${glb.status}`);
      fs.writeFileSync(`${root}models/${job.name}.glb`, Buffer.from(await glb.arrayBuffer()));
      console.log(`${job.name}: saved models/${job.name}.glb`);
    } catch (err) {
      console.error(`${job.name}: ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
