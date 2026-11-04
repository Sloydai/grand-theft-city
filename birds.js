// Birds: flocks of pigeons on the squares (pecking, walking, bursting into flight when
// someone comes close, landing again later) and gulls and pigeons circling overhead. All
// instanced; wings flap in the vertex shader.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const coloured = (g, color) => {
  const n = g.index ? g.toNonIndexed() : g, c = new THREE.Color(color), colors = new Float32Array(n.attributes.position.count * 3);
  for (const k of Object.keys(n.attributes)) if (!['normal', 'position'].includes(k)) n.deleteAttribute(k);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  n.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return n;
};
// Pigeon standing (+z forward, feet at y = 0, ~0.32 m long): grey body, iridescent neck, dark
// wing bars, pink legs.
function pigeonStanding() {
  return mergeGeometries([
    coloured(new THREE.SphereGeometry(0.1, 10, 8).scale(0.9, 0.85, 1.45).translate(0, 0.15, 0), 0x8b929e),
    coloured(new THREE.SphereGeometry(0.06, 8, 6).scale(1, 1.2, 1).translate(0, 0.22, 0.1), 0x4f7d6e),
    coloured(new THREE.SphereGeometry(0.045, 8, 6).translate(0, 0.27, 0.13), 0x6c7380),
    coloured(new THREE.ConeGeometry(0.012, 0.035, 5).rotateX(Math.PI / 2).translate(0, 0.265, 0.18), 0x2b2b2b),
    coloured(new THREE.BoxGeometry(0.11, 0.02, 0.14).rotateX(-0.25).translate(0, 0.16, -0.16), 0x5e6570),
    coloured(new THREE.BoxGeometry(0.19, 0.03, 0.05).translate(0, 0.2, -0.04), 0x2f3338),
    coloured(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 4).translate(0.03, 0.04, 0.01), 0xc06a6a),
    coloured(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 4).translate(-0.03, 0.04, 0.01), 0xc06a6a),
  ]);
}
// Bird in flight: body plus two wings; the wing vertices carry their span (|x|) for flapping.
function birdFlying(span, body, wing) {
  const wings = [-1, 1].map((s) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.08, s * span, 0, -0.02, 0, 0, -0.12, s * span * 0.55, 0, 0.05, s * span, 0, -0.02, 0, 0, 0.08], 3));
    g.computeVertexNormals();
    return coloured(g, wing);
  });
  return mergeGeometries([coloured(new THREE.SphereGeometry(0.08, 8, 6).scale(0.8, 0.7, 2.2), body), ...wings]);
}
function flapMaterial(time) {
  const m = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.flapTime = time;
    shader.vertexShader = 'uniform float flapTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float phase = float(gl_InstanceID) * 1.7;
      transformed.y += sin(flapTime * 11.0 + phase) * abs(position.x) * 0.9;`);
  };
  return m;
}

// squares: [[x, z, radius]] where pigeons gather; heightAt(x, z): ground; threats(): [[x, z]]
// of the player and vehicles that scare them.
export function createBirds({ heightAt, scene, squares, threats }) {
  const time = { value: 0 };
  let seed = 11;
  const rand = (a = 0, b = 1) => { seed = (seed * 16807) % 2147483647; return a + ((seed - 1) / 2147483646) * (b - a); };
  // Ground flocks.
  const pigeons = [];
  for (const [cx, cz, r] of squares) {
    const n = Math.round(rand(10, 20));
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), d = Math.sqrt(rand()) * r * 0.6;
      pigeons.push({ air: 0, cx, cz, h: rand(0, Math.PI * 2), peck: rand(0, 6), r, state: 'ground', vx: 0, vy: 0, vz: 0, x: cx + Math.cos(a) * d, y: 0, z: cz + Math.sin(a) * d });
    }
  }
  const standing = new THREE.InstancedMesh(pigeonStanding(), new THREE.MeshLambertMaterial({ vertexColors: true }), Math.max(1, pigeons.length));
  const flying = new THREE.InstancedMesh(birdFlying(0.32, 0x8b929e, 0x6d737d), flapMaterial(time), Math.max(1, pigeons.length));
  // Gulls circling the harbour and pigeons over the roofs.
  const sky = [];
  for (let flock = 0; flock < 6; flock++) {
    const cx = rand(-900, 900), cz = rand(-500, 600), gull = flock < 3, n = Math.round(rand(5, 9)), radius = rand(40, 90), alt = rand(30, 60);
    for (let i = 0; i < n; i++) sky.push({ alt: alt + rand(-6, 6), cx: cx + rand(-15, 15), cz: cz + rand(-15, 15), gull, phase: rand(0, Math.PI * 2), radius: radius + rand(-10, 10), speed: (gull ? 9 : 12) / radius });
  }
  const gulls = new THREE.InstancedMesh(birdFlying(0.75, 0xf4f4f2, 0xc9ccd0), flapMaterial(time), Math.max(1, sky.length));
  for (const mesh of [standing, flying, gulls]) { mesh.frustumCulled = false; mesh.castShadow = true; scene.add(mesh); }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), big = new THREE.Vector3(1.4, 1.4, 1.4);
  return {
    update(dt, seconds) {
      time.value = seconds;
      const danger = threats();
      let s = 0, f = 0;
      for (const b of pigeons) {
        if (b.state === 'ground') {
          // Peck about, wander a little, startle when something comes within 6 m.
          b.peck += dt * 6;
          if (rand() < dt * 0.4) b.h += rand(-1.5, 1.5);
          const step = Math.sin(b.peck) > 0.3 ? 0 : 0.25 * dt;
          b.x += Math.sin(b.h) * step; b.z += Math.cos(b.h) * step;
          if (Math.hypot(b.x - b.cx, b.z - b.cz) > b.r * 0.7) b.h = Math.atan2(b.cx - b.x, b.cz - b.z);
          const near = danger.find(([x, z]) => Math.hypot(x - b.x, z - b.z) < 6);
          if (near) {
            const away = Math.atan2(b.x - near[0], b.z - near[1]) + rand(-0.6, 0.6);
            Object.assign(b, { air: rand(8, 16), h: away, state: 'air', vx: Math.sin(away) * 7, vy: rand(3, 5), vz: Math.cos(away) * 7, y: heightAt(b.x, b.z) });
          }
          const bob = Math.max(0, Math.sin(b.peck)) * 0.6;
          e.set(bob, b.h, 0);
          m.compose(p.set(b.x, heightAt(b.x, b.z), b.z), q.setFromEuler(e), one);
          standing.setMatrixAt(s++, m);
        } else {
          // Climb away, circle back and glide down onto the square again.
          b.air -= dt;
          const ground = heightAt(b.x, b.z);
          if (b.air > 0) { b.vy += (b.y < ground + 12 ? 2 : -1.5) * dt; b.h += dt * 0.6; b.vx = Math.sin(b.h) * 7; b.vz = Math.cos(b.h) * 7; }
          else { const to = Math.atan2(b.cx - b.x, b.cz - b.z); b.h = to; b.vx = Math.sin(to) * 5; b.vz = Math.cos(to) * 5; b.vy = -2; }
          b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
          if (b.air <= 0 && b.y <= ground && Math.hypot(b.x - b.cx, b.z - b.cz) < b.r * 0.7) { b.state = 'ground'; b.y = ground; }
          b.y = Math.max(b.y, ground);
          e.set(-b.vy * 0.08, b.h, 0);
          m.compose(p.set(b.x, b.y + 0.15, b.z), q.setFromEuler(e), one);
          flying.setMatrixAt(f++, m);
        }
      }
      standing.count = s; flying.count = f;
      sky.forEach((b, i) => {
        const a = b.phase + seconds * b.speed, x = b.cx + Math.cos(a) * b.radius, z = b.cz + Math.sin(a) * b.radius;
        e.set(0, Math.atan2(-Math.sin(a), Math.cos(a)), -0.35);
        m.compose(p.set(x, heightAt(x, z) + b.alt + Math.sin(a * 3) * 2, z), q.setFromEuler(e), b.gull ? big : one);
        gulls.setMatrixAt(i, m);
      });
      for (const mesh of [standing, flying, gulls]) mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
