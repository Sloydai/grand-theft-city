// The ground's surface types (grass, woodland, sand, pitches, playgrounds, flowerbeds,
// paving, parking) painted onto the terrain itself by one material: two RGBA masks at 2 m
// per pixel hold each type's weight (later layers cover earlier ones, as a map draws them),
// and the shader blends the tiled textures. One surface, so layers can never fight.
import * as THREE from 'three';

// bounds: { minX, minZ, maxX, maxZ }; base: { map, tint }; layers (draw order, at most 8):
// [{ polys, map, metres, tint }]. Returns a MeshLambertMaterial for the terrain tiles.
export function groundMaterial({ base, bounds, layers, metres = 2 }) {
  const W = Math.ceil((bounds.maxX - bounds.minX) / metres), H = Math.ceil((bounds.maxZ - bounds.minZ) / metres), n = W * H;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const remaining = new Float32Array(n).fill(1), packed = [new Uint8ClampedArray(n * 4), new Uint8ClampedArray(n * 4)];
  // Top layer first: each takes its coverage of what the layers above left over.
  for (let k = layers.length - 1; k >= 0; k--) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff';
    for (const p of layers[k].polys) {
      g.beginPath();
      p.forEach(([x, z], i) => (i ? g.lineTo((x - bounds.minX) / metres, (z - bounds.minZ) / metres) : g.moveTo((x - bounds.minX) / metres, (z - bounds.minZ) / metres)));
      g.closePath();
      g.fill();
    }
    const px = g.getImageData(0, 0, W, H).data, out = packed[k >> 2], c = k & 3;
    for (let i = 0; i < n; i++) {
      const m = px[i * 4] / 255;
      if (!m) continue;
      out[i * 4 + c] = Math.round(m * remaining[i] * 255);
      remaining[i] *= 1 - m;
    }
  }
  const masks = packed.map((data) => {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  });
  const material = new THREE.MeshLambertMaterial({ map: base.map });
  const slots = Array.from({ length: 8 }, (_, k) => layers[k] || { map: base.map, metres: 1, tint: new THREE.Color(1, 1, 1) });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.groundMasks = { value: masks };
    shader.uniforms.groundMin = { value: new THREE.Vector2(bounds.minX, bounds.minZ) };
    shader.uniforms.groundSize = { value: new THREE.Vector2(W * metres, H * metres) };
    shader.uniforms.groundBaseTint = { value: new THREE.Color(base.tint ?? 0xffffff) };
    slots.forEach((l, k) => {
      shader.uniforms[`groundTex${k}`] = { value: l.map };
      shader.uniforms[`groundScale${k}`] = { value: 1 / l.metres };
      shader.uniforms[`groundTint${k}`] = { value: new THREE.Color(l.tint ?? 0xffffff) };
    });
    shader.vertexShader = 'varying vec3 vGroundPos;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const decl = slots.map((_, k) => `uniform sampler2D groundTex${k}; uniform float groundScale${k}; uniform vec3 groundTint${k};`).join('\n');
    const sample = (k) => `texture2D(groundTex${k}, vGroundPos.xz * groundScale${k}).rgb * groundTint${k}`;
    shader.fragmentShader = `varying vec3 vGroundPos; uniform sampler2D groundMasks[2]; uniform vec2 groundMin; uniform vec2 groundSize; uniform vec3 groundBaseTint;\n${decl}\n` + shader.fragmentShader.replace('#include <map_fragment>', `
      vec2 groundUv = (vGroundPos.xz - groundMin) / groundSize;
      // The masks are 2 m a pixel: sharpen their soft bilinear edges so ground types meet
      // in a narrow seam instead of smearing into each other over metres.
      vec4 wa = smoothstep(0.3, 0.7, texture2D(groundMasks[0], groundUv)), wb = smoothstep(0.3, 0.7, texture2D(groundMasks[1], groundUv));
      float rest = clamp(1.0 - (wa.r + wa.g + wa.b + wa.a + wb.r + wb.g + wb.b + wb.a), 0.0, 1.0);
      vec3 ground = texture2D(map, vMapUv).rgb * groundBaseTint * rest
        + ${sample(0)} * wa.r + ${sample(1)} * wa.g + ${sample(2)} * wa.b + ${sample(3)} * wa.a
        + ${sample(4)} * wb.r + ${sample(5)} * wb.g + ${sample(6)} * wb.b + ${sample(7)} * wb.a;
      diffuseColor.rgb *= ground;`);
  };
  return material;
}
