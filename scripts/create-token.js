// scripts/create-token.js — cria um token de acesso à API
//
// Uso:
//   npm run create-token -- --role admin   --label "CADD Coordenadora"
//   npm run create-token -- --role cadd    --label "Avaliador 1"
//   npm run create-token -- --role docente --label "João Silva" --bi 003456789LA042
//
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.CADD_DB || path.join(__dirname, '..', 'data', 'cadd.db');

function arg(name, def='') {
  const i = process.argv.indexOf('--'+name);
  return i>=0 ? (process.argv[i+1] || def) : def;
}

const role  = arg('role');
const label = arg('label');
const bi    = arg('bi');

if (!role || !['docente','cadd','admin'].includes(role)) {
  console.error('Uso: npm run create-token -- --role <docente|cadd|admin> --label "..." [--bi 0034...]');
  process.exit(1);
}

const db = new Database(DB_PATH);
const id = crypto.randomUUID();
const token = crypto.randomBytes(24).toString('base64url');

db.prepare(`
  INSERT INTO tokens (id, token, role, label, bi, active)
  VALUES (?, ?, ?, ?, ?, 1)
`).run(id, token, role, label || null, bi || null);

console.log('✓ Token criado');
console.log('  id    :', id);
console.log('  role  :', role);
console.log('  label :', label || '(sem label)');
console.log('  bi    :', bi || '(qualquer)');
console.log('  TOKEN :', token);
console.log('\nGuarde este token com cuidado — não pode ser recuperado depois.');
console.log('No frontend, configure-o em BACKEND_URL e injecte como cabeçalho X-CADD-Token.');
