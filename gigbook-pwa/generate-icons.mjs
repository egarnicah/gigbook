/**
 * GigBook — generate-icons.mjs
 * Genera los íconos PWA (192x192 y 512x512) con canvas.
 * No requiere dependencias externas — solo Node.js 18+.
 *
 * Uso:
 *   node generate-icons.mjs
 *
 * Salida:
 *   public/icons/icon-192.png
 *   public/icons/icon-512.png
 */

import { createCanvas } from 'canvas';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx    = canvas.getContext('2d');
  const pad    = size * 0.1;
  const r      = size * 0.18; // border radius

  // fondo negro redondeado
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.moveTo(pad + r, pad);
  ctx.lineTo(size - pad - r, pad);
  ctx.quadraticCurveTo(size - pad, pad, size - pad, pad + r);
  ctx.lineTo(size - pad, size - pad - r);
  ctx.quadraticCurveTo(size - pad, size - pad, size - pad - r, size - pad);
  ctx.lineTo(pad + r, size - pad);
  ctx.quadraticCurveTo(pad, size - pad, pad, size - pad - r);
  ctx.lineTo(pad, pad + r);
  ctx.quadraticCurveTo(pad, pad, pad + r, pad);
  ctx.closePath();
  ctx.fill();

  // emoji guitarra centrado
  const fontSize = size * 0.45;
  ctx.font      = `${fontSize}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🎸', size / 2, size / 2);

  // acento amarillo — línea inferior
  ctx.fillStyle  = '#e8ff3a';
  ctx.fillRect(pad * 1.5, size * 0.78, size - pad * 3, size * 0.04);

  return canvas.toBuffer('image/png');
}

// — Si canvas no está disponible, genera un SVG base64 como fallback —
function generateIconSVG(size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size*0.18}" fill="#0a0a0a"/>
  <text x="50%" y="50%" font-size="${size*0.45}" text-anchor="middle" dominant-baseline="middle">🎸</text>
  <rect x="${size*0.15}" y="${size*0.78}" width="${size*0.7}" height="${size*0.04}" fill="#e8ff3a"/>
</svg>`;
  return Buffer.from(svg);
}

const outDir = join(__dir, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  let buf;
  try {
    buf = generateIcon(size);
    console.log(`✓ icon-${size}.png (canvas)`);
  } catch {
    // canvas no instalado — usa SVG (renombrado como .svg, válido para manifest)
    buf = generateIconSVG(size);
    const svgPath = join(outDir, `icon-${size}.svg`);
    writeFileSync(svgPath, buf);
    console.log(`✓ icon-${size}.svg (fallback SVG — instala 'canvas' para PNG)`);
    continue;
  }
  writeFileSync(join(outDir, `icon-${size}.png`), buf);
}

console.log('\n📁 Íconos generados en public/icons/');
console.log('   Actualiza manifest.json si usaste SVG como fallback.\n');
