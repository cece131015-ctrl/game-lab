// Copia el HTML unico generado a turbo-liga.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'dist-single', 'index.html');
const dst = path.join(root, 'turbo-liga.html');
fs.copyFileSync(src, dst);
const kb = Math.round(fs.statSync(dst).size / 1024);
console.log(`turbo-liga.html generado (${kb} KB)`);
