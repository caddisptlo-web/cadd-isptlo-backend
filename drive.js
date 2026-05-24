/* =========================================================
   ILR : Academic Solutions — Plataforma CADD ISPTLO v3.0
   Integração Google Drive (drive.js)
   --------------------------------------------------------
   Service Account → guardar/listar/baixar evidências
   --------------------------------------------------------
   Para activar, fornecer:
     - DRIVE_SA_KEY_PATH=./data/service-account.json (chave da service account)
     - DRIVE_ROOT_FOLDER_ID=<id da pasta raiz CADD-ISPTLO>
     - DRIVE_SHARE_EMAIL=cadd.isptlo@gmail.com  (a coordenadora vê a pasta)
   ========================================================= */

import fs from 'node:fs';
import path from 'node:path';

let driveClient = null;
let ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID || '';

export async function initDrive(){
  const keyPath = process.env.DRIVE_SA_KEY_PATH || path.join(process.cwd(), 'data', 'service-account.json');
  if(!fs.existsSync(keyPath)){
    console.warn('[Drive] Service account não configurada. Saltando integração Drive.');
    return null;
  }
  try{
    // Importação dinâmica de googleapis para não obrigar a instalar quando não for usado
    const { google } = await import('googleapis');
    const auth = new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/drive']
    });
    driveClient = google.drive({ version: 'v3', auth });
    console.log('[Drive] Integração Google Drive inicializada.');
    return driveClient;
  }catch(err){
    console.warn('[Drive] Erro ao inicializar:', err.message);
    return null;
  }
}

export function isDriveActive(){
  return !!driveClient;
}

/* Cria pasta se não existir; retorna ID */
export async function ensureFolder(name, parentId){
  if(!driveClient) throw new Error('Drive não inicializada');
  const safeName = name.replace(/'/g, "\\'");
  const q = `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentId?` and '${parentId}' in parents`:''}`;
  const list = await driveClient.files.list({ q, fields: 'files(id,name)' });
  if(list.data.files.length){
    return list.data.files[0].id;
  }
  const meta = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentId ? [parentId] : (ROOT_FOLDER_ID ? [ROOT_FOLDER_ID] : undefined)
  };
  const r = await driveClient.files.create({ requestBody: meta, fields: 'id' });
  return r.data.id;
}

/* Cria estrutura: <ciclo>/<BI - Nome>/<tipo>/ e devolve folderId */
export async function getEvidenceFolder(ciclo, biNome, tipo='evidencias'){
  if(!ROOT_FOLDER_ID){
    ROOT_FOLDER_ID = await ensureFolder('CADD-ISPTLO');
  }
  const cicloId  = await ensureFolder(ciclo,  ROOT_FOLDER_ID);
  const biId     = await ensureFolder(biNome, cicloId);
  const tipoId   = await ensureFolder(tipo,   biId);
  return tipoId;
}

/* Faz upload de buffer para o Drive */
export async function uploadToDrive({ ciclo, biNome, tipo, fileName, mimeType, buffer }){
  if(!driveClient) throw new Error('Drive não inicializada');
  const folderId = await getEvidenceFolder(ciclo, biNome, tipo);
  const { Readable } = await import('node:stream');
  const stream = Readable.from(buffer);
  const r = await driveClient.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: stream },
    fields: 'id, name, webViewLink, webContentLink, size'
  });
  return r.data;
}

/* Listar ficheiros de uma pasta de evidências */
export async function listEvidencias(ciclo, biNome){
  if(!driveClient) throw new Error('Drive não inicializada');
  const folderId = await getEvidenceFolder(ciclo, biNome, 'evidencias');
  const r = await driveClient.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,size,createdTime,webViewLink)',
    orderBy: 'createdTime desc'
  });
  return r.data.files;
}

/* Partilhar a pasta raiz com a Coordenadora (uma vez) */
export async function compartilharComCoordenadora(){
  if(!driveClient || !ROOT_FOLDER_ID) return null;
  const email = process.env.DRIVE_SHARE_EMAIL || 'cadd.isptlo@gmail.com';
  try{
    const r = await driveClient.permissions.create({
      fileId: ROOT_FOLDER_ID,
      requestBody: { type: 'user', role: 'writer', emailAddress: email },
      sendNotificationEmail: true
    });
    console.log('[Drive] Pasta partilhada com', email);
    return r.data;
  }catch(err){
    console.warn('[Drive] Falha ao partilhar:', err.message);
    return null;
  }
}
