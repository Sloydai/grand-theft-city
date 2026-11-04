// Procedural textures (canvas) for facades and ground cover, so nothing is downloaded.
import * as THREE from 'three';

function canvasTexture(w, h, draw, repeatMeters = 0) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // Ground shapes use world metres as UVs; repeatMeters is the size of one tile.
  if (repeatMeters) tex.repeat.set(1 / repeatMeters, 1 / repeatMeters);
  return tex;
}

// Deterministic speckle so textures look the same every load.
function speckle(g, w, h, colors, count, size = 2, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    g.fillRect(rnd() * w, rnd() * h, size * (0.5 + rnd()), size * (0.5 + rnd()));
  }
}

// Classic Oslo facade bay (about 3 m) by one storey, tinted by the wall colour: a tall
// two-leaf window in a moulded surround with a small cornice, a sill, and a string course.
export const facadeTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#f4f1ec';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, ['#ebe7e0', '#fbfaf7', '#efebe5'], 1200, 3, 7);
  // String course at the floor line.
  g.fillStyle = '#ddd7cd';
  g.fillRect(0, 238, 256, 18);
  g.fillStyle = 'rgba(0,0,0,0.10)';
  g.fillRect(0, 236, 256, 3);
  // Surround, cornice hood and sill.
  g.fillStyle = '#fbf9f5';
  g.fillRect(78, 30, 100, 180);
  g.fillStyle = '#e2ddd4';
  g.fillRect(70, 22, 116, 12);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(70, 34, 116, 4);
  g.fillStyle = '#e2ddd4';
  g.fillRect(72, 208, 112, 10);
  // Glass with a sky reflection, two leaves and a transom.
  const glass = g.createLinearGradient(0, 40, 0, 204);
  glass.addColorStop(0, '#9db4c6');
  glass.addColorStop(0.4, '#4b6072');
  glass.addColorStop(1, '#27323c');
  g.fillStyle = glass;
  g.fillRect(88, 42, 80, 162);
  g.fillStyle = '#f2f0eb';
  g.fillRect(125, 42, 6, 162);
  g.fillRect(88, 92, 80, 5);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(92, 100, 12, 100);
});

// Post-war office facade: horizontal ribbon windows between stone spandrels.
export const modernTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#e9e6e1';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, ['#e1ded8', '#f0eee9'], 600, 3, 13);
  const glass = g.createLinearGradient(0, 70, 0, 200);
  glass.addColorStop(0, '#8ea7ba');
  glass.addColorStop(1, '#33424f');
  g.fillStyle = glass;
  g.fillRect(0, 70, 256, 130);
  g.fillStyle = '#5b636b';
  for (let x = 0; x < 256; x += 64) g.fillRect(x, 70, 4, 130);
  g.fillStyle = 'rgba(0,0,0,0.15)';
  g.fillRect(0, 200, 256, 4);
});

// Curtain wall: glass panels on a mullion grid (used with a reflective material).
export const glassTexture = () => canvasTexture(256, 256, (g) => {
  const glass = g.createLinearGradient(0, 0, 256, 256);
  glass.addColorStop(0, '#6f8798');
  glass.addColorStop(1, '#2c3a46');
  g.fillStyle = glass;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#9aa3aa';
  for (let x = 0; x < 256; x += 128) g.fillRect(x, 0, 5, 256);
  g.fillRect(0, 0, 256, 6);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(10, 10, 100, 236);
});

// Ground-floor shopfront (about 6 m wide): sign band, big glass and a door.
export const shopTexture = () => canvasTexture(512, 256, (g) => {
  g.fillStyle = '#ece8e1';
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#2d3136';
  g.fillRect(0, 18, 512, 34);
  g.fillStyle = '#c9b48a';
  g.fillRect(40, 28, 150, 14);
  const glass = g.createLinearGradient(0, 64, 0, 250);
  glass.addColorStop(0, '#9fb5c6');
  glass.addColorStop(0.5, '#4a5d6c');
  glass.addColorStop(1, '#2a333b');
  g.fillStyle = '#3a3f45';
  g.fillRect(20, 60, 472, 196);
  g.fillStyle = glass;
  g.fillRect(28, 68, 300, 184);
  g.fillRect(350, 68, 134, 184);
  g.fillStyle = '#5e4a3a';
  g.fillRect(380, 110, 74, 146);
  g.fillStyle = '#9fb5c6';
  g.fillRect(390, 122, 54, 70);
  g.fillStyle = '#ffd98a';
  speckle(g, 280, 40, ['#ffe6a8', '#f6d18a'], 30, 6, 3);
});

// Brick or stone masonry without windows, for churches and monuments (tinted by colour).
export const masonryTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#d9d3ca';
  g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 5; col++) {
      g.fillStyle = ['#f0ebe3', '#e4ddd3', '#f7f3ec', '#e9e3da'][(row * 3 + col) % 4];
      g.fillRect(col * 52 + (row % 2) * 26 - 26 + 2, row * 16 + 2, 48, 12);
    }
  }
});

export const grassTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#6f9a4f';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, ['#638c45', '#7ea85c', '#5b8240', '#86ae63'], 5000, 2, 11);
}, 6);

export const woodTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#4e6e38';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, ['#3f5c2c', '#5a7c40', '#465f33', '#6b5a3c'], 4000, 3, 5);
}, 8);

// Sidewalk slabs: light grey granite flags, 60 × 40 cm in running bond (a tile is 2.4 × 2.4 m:
// 4 slabs across, 6 courses), each a slightly different tone with its own grain, worn edges
// and thin soft joints. Seeded, so every build looks the same.
export const slabTexture = () => canvasTexture(1024, 1024, (g) => {
  let seed = 31;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#7e7c77';
  g.fillRect(0, 0, 1024, 1024);
  const W = 256, H = 1024 / 6;
  for (let row = 0; row < 6; row++) for (let col = -1; col < 5; col++) {
    const x = col * W + (row % 2) * (W / 2), y = row * H, tone = 172 + Math.floor(rand() * 26) - 13, warm = Math.floor(rand() * 6);
    g.fillStyle = `rgb(${tone + warm},${tone + warm},${tone - 2})`;
    g.fillRect(x + 2, y + 2, W - 4, H - 4);
    // Grain: fine light and dark specks, denser on some slabs.
    const specks = 900 + Math.floor(rand() * 700);
    for (let k = 0; k < specks; k++) {
      const v = tone + (rand() - 0.5) * 46;
      g.fillStyle = `rgba(${v},${v},${v - 3},${0.35 + rand() * 0.4})`;
      g.fillRect(x + 2 + rand() * (W - 6), y + 2 + rand() * (H - 6), 1 + rand() * 2, 1 + rand() * 2);
    }
    // Worn edges: a slight darkening along each slab's border.
    const grad = g.createLinearGradient(x, y, x, y + H);
    grad.addColorStop(0, 'rgba(0,0,0,0.07)'); grad.addColorStop(0.08, 'rgba(0,0,0,0)'); grad.addColorStop(0.92, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.07)');
    g.fillStyle = grad;
    g.fillRect(x + 2, y + 2, W - 4, H - 4);
  }
}, 4);

// Concrete pavers for paths and squares: 20 × 10 cm stones in running bond (a tile is 1.6 m),
// warm grey, each stone its own shade, with soft joints.
export const paverTexture = () => canvasTexture(1024, 1024, (g) => {
  let seed = 53;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#857f76';
  g.fillRect(0, 0, 1024, 1024);
  const W = 128, H = 64;
  for (let row = 0; row < 16; row++) for (let col = -1; col < 9; col++) {
    const x = col * W + (row % 2) * (W / 2), y = row * H, tone = 178 + Math.floor(rand() * 30) - 15;
    g.fillStyle = `rgb(${tone + 4},${tone},${tone - 8})`;
    g.fillRect(x + 2, y + 2, W - 4, H - 4);
    for (let k = 0; k < 120; k++) {
      const v = tone + (rand() - 0.5) * 34;
      g.fillStyle = `rgba(${v + 3},${v},${v - 6},0.5)`;
      g.fillRect(x + 2 + rand() * (W - 6), y + 2 + rand() * (H - 6), 1 + rand() * 2, 1 + rand() * 2);
    }
  }
}, 4);

// Tactile warning paving: pale 30 cm tiles studded with rows of raised dots (a tile is 0.6 m).
export const tactileTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#9b9890';
  g.fillRect(0, 0, 256, 256);
  for (const [x, y] of [[0, 0], [128, 0], [0, 128], [128, 128]]) {
    g.fillStyle = '#d9d6cd';
    g.fillRect(x + 2, y + 2, 124, 124);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      const cx = x + 14 + i * 20, cy = y + 14 + j * 20, grad = g.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 7);
      grad.addColorStop(0, '#f1efe8'); grad.addColorStop(1, '#a9a69d');
      g.fillStyle = grad;
      g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.fill();
    }
  }
}, 4);

// Granite kerbstones: light grey with black and white grains.
export const graniteTexture = () => canvasTexture(128, 128, (g) => {
  g.fillStyle = '#c9c7c1';
  g.fillRect(0, 0, 128, 128);
  speckle(g, 128, 128, ['#8d8b87', '#e4e2dc', '#b0aea8', '#5f5e5b'], 1800, 1.5, 13);
}, 4);

// Open urban ground (worn concrete and packed fill): broad soft tone, fine low-contrast
// grain, so bare ground between streets reads as a calm surface rather than gravel.
export const urbanGroundTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#6f706e';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    const x = (i * 97) % 256, y = (i * 61) % 256, r = 30 + ((i * 37) % 50);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    for (const [ox, oy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) g.fillRect(x - r + ox, y - r + oy, r * 2, r * 2);
  }
  speckle(g, 256, 256, ['#6a6b69', '#747573', '#6d6e6c'], 3000, 1, 21);
}, 4);

export const asphaltTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#4a4c50';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, ['#43454a', '#55575b', '#3d3f43'], 4000, 2, 9);
}, 5);

export const sandTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#d8c9a3';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, ['#cdbd95', '#e3d6b4', '#c4b38a'], 4000, 2, 4);
}, 4);

export const flowersTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#5d4632';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, ['#4f7a3a', '#5d8a45'], 2500, 4, 6);
  speckle(g, 256, 256, ['#e04b5a', '#f2c94c', '#e88bd0', '#ffffff', '#f07c2c'], 900, 4, 8);
}, 3);

export const pitchTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#4f9a4a';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 64) { g.fillStyle = '#58a453'; g.fillRect(i, 0, 32, 256); }
}, 12);

export const planksTexture = () => canvasTexture(256, 256, (g) => {
  for (let i = 0; i < 16; i++) {
    g.fillStyle = ['#7a5c40', '#8a6a4b', '#6f5238', '#80624a'][i % 4];
    g.fillRect(0, i * 16, 256, 15);
    g.fillStyle = '#4b3826';
    g.fillRect(0, i * 16 + 15, 256, 1);
  }
}, 4);

export const stoneTexture = () => canvasTexture(256, 128, (g) => {
  g.fillStyle = '#7d7a73';
  g.fillRect(0, 0, 256, 128);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      g.fillStyle = ['#8a867e', '#76726b', '#827e76', '#6e6a63'][(row + col) % 4];
      g.fillRect(col * 52 + (row % 2) * 26 + 2, row * 32 + 2, 48, 28);
    }
  }
}, 0);

// Tileable wave normal map: a sum of integer-frequency sines, so the edges match.
export function waterNormals() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const waves = [[3, 1, 0.9, 0.3], [1, 4, 0.7, 1.7], [5, 3, 0.4, 2.2], [7, -2, 0.3, 0.9], [2, -6, 0.25, 4.1], [11, 5, 0.15, 1.3]];
  const height = (x, y) => waves.reduce((sum, [fx, fy, a, ph]) => sum + a * Math.sin((2 * Math.PI * (fx * x + fy * y)) / size + ph), 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = height(x + 1, y) - height(x - 1, y), dy = height(x, y + 1) - height(x, y - 1);
      const n = new THREE.Vector3(-dx * 2.5, -dy * 2.5, 1).normalize();
      const i = (y * size + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Night lighting (emissive maps). Each covers 4 x 4 window bays with a random mix of lit
// and dark windows, so the pattern does not repeat every bay; set repeat to 1/4.
function litWindows(draw) {
  return canvasTexture(512, 512, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 512, 512);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const warm = ['#ffd59a', '#ffe7b8', '#ffc77a', '#f6e2c2', '#cfe3ff'];
    for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) draw(g, bx * 128, by * 128, rnd, warm);
  });
}
export const facadeNight = () => litWindows((g, x, y, rnd, warm) => {
  if (rnd() < 0.42) { g.fillStyle = warm[Math.floor(rnd() * warm.length)]; g.fillRect(x + 44, y + 21, 40, 81); }
});
export const modernNight = () => litWindows((g, x, y, rnd, warm) => {
  if (rnd() < 0.5) { g.fillStyle = rnd() < 0.7 ? '#e9f1ff' : warm[0]; g.fillRect(x, y + 35, 128, 65); }
});
export const shopNight = () => canvasTexture(512, 256, (g) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#ffdca0';
  g.fillRect(28, 68, 300, 184);
  g.fillRect(350, 68, 134, 184);
  g.fillStyle = '#fff3c4';
  g.fillRect(40, 28, 150, 14);
});

// Surface maps for the facades (green = roughness, blue = metalness, linear): matt render
// and stone, glossy glass that reflects the sky. Same layout as the colour textures above.
function surfaceTexture(w, h, glassRects) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(0,235,0)';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgb(0,18,150)';
  for (const [x, y, rw, rh] of glassRects) g.fillRect(x, y, rw, rh);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
export const facadeSurface = () => surfaceTexture(256, 256, [[88, 42, 37, 50], [131, 42, 37, 50], [88, 97, 37, 107], [131, 97, 37, 107]]);
export const modernSurface = () => surfaceTexture(256, 256, [[4, 70, 60, 130], [68, 70, 60, 130], [132, 70, 60, 130], [196, 70, 60, 130]]);
export const shopSurface = () => surfaceTexture(512, 256, [[28, 68, 300, 184], [350, 68, 30, 184], [390, 122, 54, 70], [454, 68, 30, 184]]);
export const radhusSurface = () => surfaceTexture(128, 128, [[46, 0, 36, 128]]);

// Oslo City Hall: dark red hand-made brick with tall, unbroken window strips (one floor
// per tile, so the strips run the height of the facade).
export const radhusTexture = () => canvasTexture(128, 128, (g) => {
  g.fillStyle = '#e9e2dc';
  g.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 32; row++) {
    for (let col = 0; col < 6; col++) {
      g.fillStyle = ['#f6f0ea', '#e2d6cc', '#efe6de', '#d8cbc0'][(row * 5 + col * 3) % 4];
      g.fillRect(col * 24 + (row % 2) * 12 - 12 + 1, row * 4 + 1, 22, 3);
    }
  }
  g.fillStyle = '#cfc6bd';
  g.fillRect(42, 0, 44, 128);
  const glass = g.createLinearGradient(0, 0, 0, 128);
  glass.addColorStop(0, '#5a6d7c');
  glass.addColorStop(1, '#25303a');
  g.fillStyle = glass;
  g.fillRect(46, 0, 36, 128);
  g.fillStyle = '#3b3a38';
  g.fillRect(62, 0, 4, 128);
  for (let y = 0; y < 128; y += 32) g.fillRect(46, y, 36, 3);
});
export const radhusNight = () => canvasTexture(128, 128, (g) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#ffd890';
  g.fillRect(46, 4, 36, 120);
});

// 19th-century station and civic facade: round-arched windows in moulded surrounds with
// keystones, on a smooth render (Østbanehallen and its neighbours).
export const archedTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#f5f2ec';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, ['#ece8e1', '#fbfaf7'], 900, 3, 17);
  g.fillStyle = '#ddd7cd';
  g.fillRect(0, 238, 256, 18);
  // Pilasters either side.
  g.fillStyle = '#ebe6dd';
  g.fillRect(0, 0, 14, 238);
  g.fillRect(242, 0, 14, 238);
  // Arched surround, keystone and sill.
  g.fillStyle = '#e4ded3';
  g.beginPath(); g.moveTo(70, 214); g.lineTo(70, 92); g.arc(128, 92, 58, Math.PI, 0); g.lineTo(186, 214); g.closePath(); g.fill();
  g.fillStyle = '#d7d0c4';
  g.fillRect(118, 26, 20, 22);
  g.fillRect(64, 208, 128, 10);
  const glass = g.createLinearGradient(0, 40, 0, 206);
  glass.addColorStop(0, '#9db4c6'); glass.addColorStop(0.45, '#4b6072'); glass.addColorStop(1, '#27323c');
  g.fillStyle = glass;
  g.beginPath(); g.moveTo(82, 206); g.lineTo(82, 96); g.arc(128, 96, 46, Math.PI, 0); g.lineTo(174, 206); g.closePath(); g.fill();
  g.fillStyle = '#f2f0eb';
  g.fillRect(125, 52, 6, 154);
  g.fillRect(82, 112, 92, 5);
});
export const archedSurface = () => surfaceTexture(256, 256, [[84, 60, 40, 146], [131, 60, 40, 146]]);

// Granite setts (gutter stones): small grey blocks in rows, with dark joints.
export const settsTexture = () => canvasTexture(128, 128, (g) => {
  g.fillStyle = '#4a4946';
  g.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 6; col++) {
      g.fillStyle = ['#8d8a84', '#9a968f', '#7f7c77', '#a5a199', '#86837d'][(row * 7 + col * 3) % 5];
      g.fillRect(col * 22 + (row % 2) * 11 - 11 + 2, row * 32 + 2, 19, 28);
    }
  }
});
