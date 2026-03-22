// Genera un icono PNG simple para GigBook Desktop
// Requiere: npm install canvas

import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';

const size = 256;
const canvas = createCanvas(size, size);
const ctx = canvas.getContext('2d');

// Fondo
ctx.fillStyle = '#0a0a0a';
ctx.fillRect(0, 0, size, size);

// Circulo
ctx.beginPath();
ctx.arc(size/2, size/2, size * 0.4, 0, Math.PI * 2);
ctx.fillStyle = '#e8ff3a';
ctx.fill();

// Guitarra (simplificada)
ctx.strokeStyle = '#0a0a0a';
ctx.lineWidth = 12;
ctx.lineCap = 'round';

// Mastil
ctx.beginPath();
ctx.moveTo(size * 0.55, size * 0.25);
ctx.lineTo(size * 0.55, size * 0.75);
ctx.stroke();

// Cuerpo
ctx.beginPath();
ctx.arc(size * 0.38, size * 0.58, size * 0.22, 0, Math.PI * 2);
ctx.stroke();

const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(path.join(process.cwd(), 'icon.png'), buffer);
console.log('Icono generado: icon.png');
