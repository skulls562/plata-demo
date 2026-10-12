// Runs Next.js with deterministic, non-secret values suitable only for this public demo.
import { spawn } from 'node:child_process';
import path from 'node:path';

const mode = process.argv[2];
const extra = process.argv.slice(3);
if (!['dev', 'build', 'start'].includes(mode)) {
  console.error('Uso: node scripts/next-demo.mjs <dev|build|start> [...args]');
  process.exit(2);
}

const demoEnv = {
  ...process.env,
  PLATA_DB_PATH: process.env.PLATA_DB_PATH ?? 'data/panel-dev.db',
  PLATA_TOKEN: process.env.PLATA_TOKEN ?? 'demo_public_token_00000000000000000000000000000000',
  PLATA_SESION_SECRETO: process.env.PLATA_SESION_SECRETO ?? 'demo_public_session_111111111111111111111111111111',
  PLATA_TELEGRAM_CHAT_ID: process.env.PLATA_TELEGRAM_CHAT_ID ?? '1',
  PLATA_HOSTS: process.env.PLATA_HOSTS ?? '127.0.0.1:3010,localhost:3010',
};

const nextBin = path.join('node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [nextBin, mode, ...extra], {
  env: demoEnv,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

