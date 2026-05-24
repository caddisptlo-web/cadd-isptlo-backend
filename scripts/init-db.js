// scripts/init-db.js — cria a base de dados SQLite do servidor CADD
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.CADD_DB || path.join(__dirname, '..', 'data', 'cadd.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS avaliacoes (
    id           TEXT PRIMARY KEY,
    bi           TEXT NOT NULL,
    ciclo        TEXT NOT NULL,
    nome         TEXT NOT NULL,
    email        TEXT,
    dei          TEXT,
    categoria    TEXT,
    grau         TEXT,
    regime       TEXT,
    total        REAL,
    nivel        TEXT,
    payload      TEXT NOT NULL,
    submitted_by TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE (bi, ciclo)
  );
  CREATE INDEX IF NOT EXISTS idx_avaliacoes_ciclo ON avaliacoes(ciclo);
  CREATE INDEX IF NOT EXISTS idx_avaliacoes_dei ON avaliacoes(dei);

  CREATE TABLE IF NOT EXISTS tokens (
    id         TEXT PRIMARY KEY,
    token      TEXT UNIQUE NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('docente','cadd','admin')),
    label      TEXT,
    bi         TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    actor      TEXT,
    action     TEXT,
    target     TEXT,
    payload    TEXT,
    ts         TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

console.log('✓ Base de dados inicializada em', DB_PATH);
console.log('  — Tabelas: avaliacoes, tokens, audit_log');
console.log('\nPróximo passo: criar tokens com');
console.log('  npm run create-token');
