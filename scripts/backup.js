// scripts/backup.js — copia o ficheiro da BD para data/backups/ com timestamp
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.CADD_DB || path.join(__dirname, '..', 'data', 'cadd.db');
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g,'-');
const dest = path.join(BACKUP_DIR, `cadd-${ts}.db`);
fs.copyFileSync(DB_PATH, dest);
console.log('✓ Backup criado em', dest);
