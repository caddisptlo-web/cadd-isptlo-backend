// =============================================================
// ILR : Academic Solutions — Backend Plataforma CADD ISPTLO
// Servidor Node.js + Express + SQLite (better-sqlite3)
// =============================================================
//
// Como correr:
//   1. cd backend
//   2. npm install
//   3. npm run init-db          (uma única vez — cria a base de dados)
//   4. npm run create-token     (cria token de docente / CADD / admin)
//   5. npm start                (servidor a escutar em http://0.0.0.0:4000)
//
// =============================================================

import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initB2, isB2Active, uploadToB2, listB2, getSignedUrl } from './b2.js';
import { notificarCADDdeNovaSubmissao, notificarDocenteValidacao } from './email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH    = process.env.CADD_DB    || path.join(__dirname, 'data', 'cadd.db');
const UPLOAD_DIR = process.env.CADD_UPLOAD|| path.join(__dirname, 'data', 'uploads');
const SYNC_DIR   = process.env.CADD_SYNC  || ''; // ex: C:/Users/.../OneDrive/CADD-ISPTLO
const PORT       = parseInt(process.env.CADD_PORT || '4000', 10);
const HOST       = process.env.CADD_HOST  || '0.0.0.0';

// Garantir directório de uploads
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
ensureDir(path.dirname(DB_PATH));
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function safePath(...parts){
  const p = path.join(UPLOAD_DIR, ...parts.map(s => s.replace(/[^a-zA-Z0-9_\-. @]/g,'_')));
  if(!p.startsWith(UPLOAD_DIR)) throw new Error('Path traversal detectado.');
  return p;
}

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function syncToCloud(srcPath, relPath){
  if(!SYNC_DIR) return;
  try{
    const dest = path.join(SYNC_DIR, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(srcPath, dest);
  }catch(e){ console.warn('Sync falhou:', e.message); }
}

// --------------------------------------------------------------
// Base de dados
// --------------------------------------------------------------

// --------------------------------------------------------------
// Express
// --------------------------------------------------------------
const app = express();
app.use(cors()); // restringe domínios em produção via origin: [...]
app.use(express.json({ limit: '5mb' }));

// Servir o frontend estático (ficheiros da pasta-pai)
app.use(express.static(path.join(__dirname, '..')));

// --------------------------------------------------------------
// Auth: token no cabeçalho X-CADD-Token
// --------------------------------------------------------------
function authenticate(req, res, next) {
  const tok = req.header('X-CADD-Token');
  if (!tok) return res.status(401).json({ error: 'Token em falta' });
  const row = db.prepare(
    'SELECT id, role, label, active FROM tokens WHERE token = ? AND active = 1'
  ).get(tok);
  if (!row) return res.status(401).json({ error: 'Token inválido ou inactivo' });
  req.user = row;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: 'Acesso negado para o papel ' + req.user.role });
    next();
  };
}

// --------------------------------------------------------------
// API
// --------------------------------------------------------------

// Keep-alive (Cron-job.org pinga a cada 14 minutos para evitar adormecer no Render Free)
app.get('/api/keepalive', (req, res) => {
  res.json({ alive: true, ts: new Date().toISOString() });
});

// Estado público (verificar disponibilidade)
app.get('/api/status', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM avaliacoes').get().c;
  res.json({
    ok: true,
    service: 'ILR-CADD-Backend',
    version: '1.0.0',
    db: DB_PATH,
    avaliacoes: count,
    ts: new Date().toISOString()
  });
});

// Submeter / actualizar uma avaliação
// POST /api/avaliacoes  (auth: docente | cadd | admin)
app.post('/api/avaliacoes', authenticate, (req, res) => {
  try {
    const s = req.body;
    if (!s || s.schema !== 'ilr-cadd-isptlo-v1')
      return res.status(400).json({ error: 'Schema inválido' });
    const d = s.dados || {};
    if (!d['f-nome'] || !d['f-bi'] || !d['f-ciclo'] || !d['f-dei'])
      return res.status(400).json({ error: 'Campos obrigatórios em falta (nome, BI, ciclo, DEI)' });

    const id = crypto.randomUUID();
    const key = `${d['f-bi']}@${d['f-ciclo']}`;

    // upsert por (BI + ciclo)
    const existing = db.prepare(
      'SELECT id FROM avaliacoes WHERE bi = ? AND ciclo = ?'
    ).get(d['f-bi'], d['f-ciclo']);

    const json = JSON.stringify(s);
    const totalGeral = (s.totais && s.totais.geral) || 0;
    const nivel = (s.totais && s.totais.nivel) || '—';

    if (existing) {
      db.prepare(`
        UPDATE avaliacoes SET
          nome=@nome, email=@email, dei=@dei, categoria=@categoria, grau=@grau,
          regime=@regime, total=@total, nivel=@nivel, payload=@payload,
          submitted_by=@token, updated_at=datetime('now')
        WHERE id=@id
      `).run({
        id: existing.id,
        nome: d['f-nome'], email: d['f-email']||'', dei: d['f-dei'],
        categoria: d['f-categoria']||'', grau: d['f-grau']||'',
        regime: d['f-regime']||'', total: totalGeral, nivel,
        payload: json, token: req.user.id
      });
      return res.json({ ok: true, id: existing.id, action: 'updated' });
    }

    db.prepare(`
      INSERT INTO avaliacoes
      (id, bi, ciclo, nome, email, dei, categoria, grau, regime, total, nivel,
       payload, submitted_by, created_at, updated_at)
      VALUES
      (@id, @bi, @ciclo, @nome, @email, @dei, @categoria, @grau, @regime,
       @total, @nivel, @payload, @token, datetime('now'), datetime('now'))
    `).run({
      id, bi: d['f-bi'], ciclo: d['f-ciclo'],
      nome: d['f-nome'], email: d['f-email']||'', dei: d['f-dei'],
      categoria: d['f-categoria']||'', grau: d['f-grau']||'',
      regime: d['f-regime']||'', total: totalGeral, nivel,
      payload: json, token: req.user.id
    });
    res.json({ ok: true, id, action: 'created' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Listar todas as avaliações (CADD / admin)
// GET /api/avaliacoes?ciclo=2026 — 2027&dei=...
app.get('/api/avaliacoes', authenticate, requireRole('cadd', 'admin'), (req, res) => {
  const filters = [];
  const params = {};
  if (req.query.ciclo) { filters.push('ciclo = @ciclo'); params.ciclo = req.query.ciclo; }
  if (req.query.dei)   { filters.push('dei = @dei');     params.dei = req.query.dei; }
  const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';
  const rows = db.prepare(
    `SELECT id, payload, created_at, updated_at FROM avaliacoes ${where} ORDER BY updated_at DESC`
  ).all(params);
  const out = rows.map(r => {
    const obj = JSON.parse(r.payload);
    obj._serverId = r.id;
    obj._createdAt = r.created_at;
    obj._updatedAt = r.updated_at;
    return obj;
  });
  res.json(out);
});

// Detalhe de uma avaliação por ID
app.get('/api/avaliacoes/:id', authenticate, (req, res) => {
  const r = db.prepare('SELECT * FROM avaliacoes WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Não encontrada' });
  // Docentes só vêem a sua própria avaliação (por BI no token)
  if (req.user.role === 'docente') {
    const tok = db.prepare('SELECT bi FROM tokens WHERE id = ?').get(req.user.id);
    if (tok && tok.bi && tok.bi !== r.bi)
      return res.status(403).json({ error: 'Acesso negado' });
  }
  res.json(JSON.parse(r.payload));
});

// Apagar uma avaliação (admin)
app.delete('/api/avaliacoes/:id', authenticate, requireRole('admin'), (req, res) => {
  const r = db.prepare('DELETE FROM avaliacoes WHERE id = ?').run(req.params.id);
  res.json({ ok: true, removed: r.changes });
});

// Listar ciclos disponíveis
app.get('/api/ciclos', authenticate, (req, res) => {
  const rows = db.prepare(
    'SELECT ciclo, COUNT(*) AS n, AVG(total) AS media FROM avaliacoes GROUP BY ciclo ORDER BY ciclo DESC'
  ).all();
  res.json(rows);
});

// Resumo agregado por DEI / categoria / nível para um ciclo
app.get('/api/resumo', authenticate, requireRole('cadd', 'admin'), (req, res) => {
  const ciclo = req.query.ciclo;
  if (!ciclo) return res.status(400).json({ error: 'parâmetro ciclo obrigatório' });
  const byDei = db.prepare(
    'SELECT dei, COUNT(*) AS n, AVG(total) AS media, MIN(total) AS min, MAX(total) AS max FROM avaliacoes WHERE ciclo = ? GROUP BY dei'
  ).all(ciclo);
  const byCat = db.prepare(
    'SELECT categoria, COUNT(*) AS n, AVG(total) AS media FROM avaliacoes WHERE ciclo = ? GROUP BY categoria'
  ).all(ciclo);
  const byNivel = db.prepare(
    'SELECT nivel, COUNT(*) AS n FROM avaliacoes WHERE ciclo = ? GROUP BY nivel'
  ).all(ciclo);
  res.json({ ciclo, byDei, byCat, byNivel });
});

// --------------------------------------------------------------
// Endpoints v2.0 — uploads, homologação, avaliadores
// --------------------------------------------------------------

// Garantir tabelas auxiliares v2
db.exec(`
  CREATE TABLE IF NOT EXISTS avaliadores (
    id TEXT PRIMARY KEY, nome TEXT, bi TEXT UNIQUE, email TEXT,
    categoria TEXT, funcao_cadd TEXT, hash_pwd TEXT,
    docentes_atribuidos TEXT, ativo INTEGER DEFAULT 1, criado_em TEXT
  );
  CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT, avaliacao_id TEXT,
    bi TEXT, ciclo TEXT, tipo TEXT, nome_orig TEXT, path TEXT,
    tamanho INTEGER, mime TEXT, ts TEXT
  );
  ALTER TABLE avaliacoes ADD COLUMN estado TEXT DEFAULT 'submetido';
  ALTER TABLE avaliacoes ADD COLUMN parecer_json TEXT;
  ALTER TABLE avaliacoes ADD COLUMN homologado_em TEXT;
  ALTER TABLE avaliacoes ADD COLUMN homologado_por TEXT;
`).catch?.(()=>{}); // ignora "duplicate column"
try {
  // sqlite não suporta IF NOT EXISTS em ALTER COLUMN; tentamos cada uma separadamente
  ['estado TEXT DEFAULT \'submetido\'','parecer_json TEXT','homologado_em TEXT','homologado_por TEXT'].forEach(col=>{
    try{ db.prepare(`ALTER TABLE avaliacoes ADD COLUMN ${col}`).run(); }catch{}
  });
} catch {}

// Upload de evidência (recebe base64 → Backblaze B2 + fallback local)
app.post('/api/upload', authenticate, express.json({limit:'15mb'}), async (req,res)=>{
  try{
    const {bi, ciclo, tipo, nomeOrig, base64, mime, nome} = req.body;
    if(!bi || !ciclo || !nomeOrig || !base64) return res.status(400).json({error:'Faltam campos obrigatórios.'});
    const buf = Buffer.from(base64, 'base64');
    if(buf.length > 10*1024*1024) return res.status(413).json({error:'Ficheiro excede 10 MB'});

    const safeName = (nome||'docente').replace(/[^a-zA-Z0-9_\- ]/g,'_');
    const biNome = `${bi}_${safeName}`;
    const fileName = nomeOrig.replace(/[^a-zA-Z0-9_\-. ]/g,'_');
    let b2Result = null;
    let localPath = null;

    // 1. Tentar Backblaze B2 primeiro
    if(isB2Active()){
      try{
        b2Result = await uploadToB2({
          ciclo, biNome, tipo: tipo||'evidencias',
          fileName, mimeType: mime||'application/octet-stream', buffer: buf
        });
      }catch(err){
        console.warn('[Upload] B2 falhou, fazendo fallback local:', err.message);
      }
    }

    // 2. Sempre: gravar localmente como backup
    const dir = safePath(ciclo, bi, tipo||'evidencias');
    ensureDir(dir);
    localPath = path.join(dir, Date.now()+'_'+fileName);
    fs.writeFileSync(localPath, buf);
    syncToCloud(localPath, path.relative(UPLOAD_DIR, localPath));

    db.prepare(`INSERT INTO uploads(bi,ciclo,tipo,nome_orig,path,tamanho,mime,ts) VALUES (?,?,?,?,?,?,?,datetime('now'))`)
      .run(bi, ciclo, tipo||'evidencias', nomeOrig, b2Result?.key || localPath, buf.length, mime||'application/octet-stream');

    res.json({
      ok: true,
      b2: b2Result ? { key: b2Result.key, url: b2Result.url } : null,
      local: path.relative(UPLOAD_DIR, localPath),
      size: buf.length
    });
  }catch(err){ console.error(err); res.status(500).json({error: err.message}); }
});

// Listar evidências de um docente num ciclo
app.get('/api/evidencias', authenticate, async (req,res)=>{
  try{
    const {bi, ciclo, nome} = req.query;
    if(!bi || !ciclo) return res.status(400).json({error:'Faltam bi e ciclo'});
    const biNome = `${bi}_${(nome||'docente').replace(/[^a-zA-Z0-9_\- ]/g,'_')}`;
    if(isB2Active()){
      try{
        const files = await listB2({ ciclo, biNome });
        // Devolver com URLs assinadas (válidas 1h)
        const filesSigned = await Promise.all(files.map(async f=>({
          ...f, signedUrl: await getSignedUrl(f.key, 3600)
        })));
        return res.json({ source:'b2', files: filesSigned });
      }catch(err){ console.warn('[B2 listar]', err.message); }
    }
    // Fallback local
    const dir = safePath(ciclo, bi, 'evidencias');
    if(!fs.existsSync(dir)) return res.json({ source:'local', files:[] });
    const files = fs.readdirSync(dir).map(name=>{
      const stat = fs.statSync(path.join(dir, name));
      return { name, size: stat.size, createdTime: stat.birthtime.toISOString() };
    });
    res.json({ source:'local', files });
  }catch(err){ res.status(500).json({error: err.message}); }
});

// Endpoint para verificar estado da integração B2
app.get('/api/storage/status', authenticate, (req,res)=>{
  res.json({
    b2: isB2Active(),
    bucket: process.env.B2_BUCKET_NAME || 'cadd-isptlo',
    fallback_local: true
  });
});

// Homologação
app.post('/api/avaliacoes/:id/homologar', authenticate, requireRole('coord_cadd','admin'), (req,res)=>{
  const r = db.prepare(`UPDATE avaliacoes SET estado='homologado', homologado_em=datetime('now'), homologado_por=? WHERE id=?`)
    .run(req.user.label||req.user.id, req.params.id);
  res.json({ok:true, changes:r.changes});
});

// Marcar parecer
app.post('/api/avaliacoes/:id/parecer', authenticate, requireRole('cadd','coord_cadd','admin'), (req,res)=>{
  const r = db.prepare(`UPDATE avaliacoes SET estado=?, parecer_json=? WHERE id=?`)
    .run(req.body.estado||'em-validacao', JSON.stringify(req.body.parecer||{}), req.params.id);
  res.json({ok:true, changes:r.changes});
});

// Sincronizar todas as avaliações para a pasta cloud (manual)
app.post('/api/sync-cloud', authenticate, requireRole('coord_cadd','admin'), (req,res)=>{
  if(!SYNC_DIR) return res.status(400).json({error:'CADD_SYNC não configurado'});
  let n=0;
  const rows = db.prepare('SELECT * FROM avaliacoes').all();
  rows.forEach(r=>{
    const ciclo = r.ciclo.replace(/[^a-zA-Z0-9_\-. ]/g,'_');
    const bi = r.bi.replace(/[^a-zA-Z0-9_\-. ]/g,'_');
    const dest = path.join(SYNC_DIR, ciclo, bi, 'avaliacao.json');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, r.payload);
    n++;
  });
  res.json({ok:true, sincronizadas:n, dir:SYNC_DIR});
});

// --------------------------------------------------------------
// Boot
// --------------------------------------------------------------
initB2();

app.listen(PORT, HOST, () => {
  console.log(`\n🪶  ILR : Academic Solutions — Backend CADD ISPTLO`);
  console.log(`    A escutar em http://${HOST}:${PORT}`);
  console.log(`    Base de dados: ${DB_PATH}`);
  console.log(`    Endpoints:`);
  console.log(`      GET  /api/status               (público)`);
  console.log(`      POST /api/avaliacoes           (auth: docente)`);
  console.log(`      GET  /api/avaliacoes           (auth: cadd, admin)`);
  console.log(`      GET  /api/avaliacoes/:id       (auth: dono ou cadd/admin)`);
  console.log(`      GET  /api/ciclos               (auth: qualquer)`);
  console.log(`      GET  /api/resumo?ciclo=...     (auth: cadd, admin)`);
  console.log(`      DEL  /api/avaliacoes/:id       (auth: admin)`);
  console.log(`      POST /api/upload               (auth: docente+) — evidências base64`);
  console.log(`      POST /api/avaliacoes/:id/homologar  (auth: coord_cadd, admin)`);
  console.log(`      POST /api/avaliacoes/:id/parecer    (auth: cadd, coord_cadd, admin)`);
  console.log(`      POST /api/sync-cloud           (auth: coord_cadd, admin)`);
  console.log();
  console.log(`    Pasta de uploads: ${UPLOAD_DIR}`);
  if(SYNC_DIR) console.log(`    Sincronização cloud: ${SYNC_DIR}`);
  else        console.log(`    Sincronização cloud: DESACTIVADA (definir CADD_SYNC para activar OneDrive/GoogleDrive)`);
  console.log();
});
