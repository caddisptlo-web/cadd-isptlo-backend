/* =========================================================
   ILR : Academic Solutions — Plataforma CADD ISPTLO v3.0.1
   Integração Backblaze B2 (S3-compatible) — b2.js
   --------------------------------------------------------
   10 GB grátis · sem cartão · API S3 padrão
   --------------------------------------------------------
   Variáveis de ambiente necessárias (definir no Render):
     B2_KEY_ID         — Application Key ID (gerada em B2 Console)
     B2_APP_KEY        — Application Key
     B2_BUCKET_NAME    — Nome do bucket (ex.: cadd-isptlo)
     B2_ENDPOINT       — Endpoint S3 (ex.: s3.us-east-005.backblazeb2.com)
     B2_REGION         — Região (ex.: us-east-005)
   ========================================================= */

import crypto from 'node:crypto';

const KEY_ID    = process.env.B2_KEY_ID || '';
const APP_KEY   = process.env.B2_APP_KEY || '';
const BUCKET    = process.env.B2_BUCKET_NAME || 'cadd-isptlo';
const ENDPOINT  = process.env.B2_ENDPOINT || 's3.us-east-005.backblazeb2.com';
const REGION    = process.env.B2_REGION || 'us-east-005';
const SERVICE   = 's3';

let active = false;

export function initB2(){
  if(!KEY_ID || !APP_KEY){
    console.warn('[B2] Não configurado (faltam B2_KEY_ID ou B2_APP_KEY). Saltando integração.');
    active = false;
    return false;
  }
  active = true;
  console.log(`[B2] Backblaze B2 inicializado — bucket=${BUCKET} · endpoint=${ENDPOINT}`);
  return true;
}

export function isB2Active(){ return active; }

/* =========================================================
   AWS Signature V4 (implementação mínima sem dependências)
   ========================================================= */
function hex(buf){
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

function sha256Hex(input){
  if(typeof input === 'string') input = Buffer.from(input, 'utf8');
  return crypto.createHash('sha256').update(input).digest('hex');
}

function hmac(key, msg){
  return crypto.createHmac('sha256', key).update(msg).digest();
}

function getSigningKey(secret, dateStamp, region, service){
  const kDate    = hmac('AWS4' + secret, dateStamp);
  const kRegion  = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSign    = hmac(kService, 'aws4_request');
  return kSign;
}

function isoDateTime(){
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}`;
  const hms = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return { amzDate: ymd+'T'+hms+'Z', dateStamp: ymd };
}

function uriEncode(s, encodeSlash=true){
  return encodeURIComponent(s).replace(/[!'()*]/g, c => '%'+c.charCodeAt(0).toString(16).toUpperCase()).replace(encodeSlash ? '' : /%2F/g, '/');
}

async function s3Request({ method, key, body, contentType, query }){
  if(!active) throw new Error('B2 não inicializado');

  const { amzDate, dateStamp } = isoDateTime();
  const host = ENDPOINT;
  const path = '/' + BUCKET + (key ? '/' + key.split('/').map(s=>uriEncode(s,false)).join('/') : '');

  const queryStr = query
    ? Object.entries(query).map(([k,v])=>`${uriEncode(k)}=${uriEncode(v)}`).sort().join('&')
    : '';

  const payloadHash = body ? sha256Hex(body) : sha256Hex('');

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    method, path, queryStr, canonicalHeaders, signedHeaders, payloadHash
  ].join('\n');

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)
  ].join('\n');

  const signingKey = getSigningKey(APP_KEY, dateStamp, REGION, SERVICE);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `https://${host}${path}` + (queryStr ? '?'+queryStr : '');
  const headers = {
    'Host': host,
    'X-Amz-Date': amzDate,
    'X-Amz-Content-Sha256': payloadHash,
    'Authorization': authHeader
  };
  if(contentType) headers['Content-Type'] = contentType;

  const res = await fetch(url, { method, headers, body });
  return res;
}

/* =========================================================
   API pública
   ========================================================= */

export async function uploadToB2({ ciclo, biNome, tipo='evidencias', fileName, mimeType, buffer }){
  if(!active) throw new Error('B2 não activo');
  const safe = s => s.replace(/[^a-zA-Z0-9_\-. ]/g, '_').replace(/\s+/g, '_');
  const key = `${safe(ciclo)}/${safe(biNome)}/${safe(tipo)}/${Date.now()}_${safe(fileName)}`;

  const res = await s3Request({
    method: 'PUT', key, body: buffer, contentType: mimeType || 'application/octet-stream'
  });
  if(!res.ok){
    const err = await res.text();
    throw new Error(`B2 upload failed (${res.status}): ${err}`);
  }
  return {
    key,
    url: `https://${ENDPOINT}/${BUCKET}/${encodeURI(key)}`,
    size: buffer.length
  };
}

export async function listB2({ ciclo, biNome, tipo='evidencias' }){
  if(!active) throw new Error('B2 não activo');
  const safe = s => s.replace(/[^a-zA-Z0-9_\-. ]/g,'_').replace(/\s+/g,'_');
  const prefix = `${safe(ciclo)}/${safe(biNome)}/${safe(tipo)}/`;
  const res = await s3Request({
    method: 'GET', key: '', query: { 'list-type':'2', prefix }
  });
  if(!res.ok) throw new Error('B2 list failed: '+res.status);
  const xml = await res.text();
  // Parser XML mínimo (sem dep externa)
  const items = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m;
  while((m = re.exec(xml)) !== null){
    const block = m[1];
    const get = tag => {
      const r = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(block);
      return r ? r[1] : '';
    };
    items.push({
      key: get('Key'),
      size: parseInt(get('Size')||'0', 10),
      lastModified: get('LastModified'),
      url: `https://${ENDPOINT}/${BUCKET}/${encodeURI(get('Key'))}`
    });
  }
  return items;
}

export async function deleteFromB2(key){
  if(!active) throw new Error('B2 não activo');
  const res = await s3Request({ method: 'DELETE', key });
  return res.ok;
}

/* URL pré-assinado (descarga) — válido 1 hora */
export async function getSignedUrl(key, expiresInSec=3600){
  if(!active) throw new Error('B2 não activo');
  const { amzDate, dateStamp } = isoDateTime();
  const host = ENDPOINT;
  const path = '/' + BUCKET + '/' + key.split('/').map(s=>uriEncode(s,false)).join('/');
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const algo = 'AWS4-HMAC-SHA256';
  const params = {
    'X-Amz-Algorithm': algo,
    'X-Amz-Credential': `${KEY_ID}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSec),
    'X-Amz-SignedHeaders': 'host'
  };
  const queryStr = Object.entries(params).map(([k,v])=>`${uriEncode(k)}=${uriEncode(v)}`).sort().join('&');
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = ['GET', path, queryStr, canonicalHeaders, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = [algo, amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = getSigningKey(APP_KEY, dateStamp, REGION, SERVICE);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `https://${host}${path}?${queryStr}&X-Amz-Signature=${signature}`;
}
