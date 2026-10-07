// Arranca el servidor de salas y el servidor de desarrollo de Vite a la vez
import { spawn } from 'node:child_process';

const procs = [
  spawn(process.execPath, ['server/index.js'], { stdio: 'inherit', env: { ...process.env, PORT: process.env.PORT || '8080' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];
const stop = () => { for (const p of procs) p.kill(); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code) stop(); });
