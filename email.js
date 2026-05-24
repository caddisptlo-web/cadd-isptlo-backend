/* =========================================================
   ILR : Academic Solutions — Plataforma CADD ISPTLO v3.0
   Notificações por e-mail (email.js)
   --------------------------------------------------------
   Suporta 2 backends:
   - Resend (recomendado): definir RESEND_API_KEY
   - SMTP fallback: definir SMTP_HOST/USER/PASS

   Sem variáveis configuradas → modo silent (loga consola).
   ========================================================= */

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL     = process.env.MAIL_FROM || 'CADD ISPTLO <noreply@cadd-isptlo.onrender.com>';
const SMTP_HOST      = process.env.SMTP_HOST || '';
const SMTP_USER      = process.env.SMTP_USER || '';
const SMTP_PASS      = process.env.SMTP_PASS || '';

let nodemailer = null;
let smtpTransport = null;

async function getSmtp(){
  if(!SMTP_HOST) return null;
  if(smtpTransport) return smtpTransport;
  try{
    const mod = await import('nodemailer');
    nodemailer = mod.default;
    smtpTransport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT||'587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    return smtpTransport;
  }catch(err){
    console.warn('[Email] nodemailer não instalado:', err.message);
    return null;
  }
}

export async function enviarEmail({ para, assunto, html, texto }){
  if(RESEND_API_KEY){
    try{
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: Array.isArray(para) ? para : [para],
          subject: assunto,
          html: html || `<p>${texto||''}</p>`,
          text: texto
        })
      });
      const data = await r.json();
      if(!r.ok) throw new Error(data.message || 'Erro Resend');
      return { ok:true, provider:'resend', id: data.id };
    }catch(err){
      console.warn('[Email] Resend falhou:', err.message);
    }
  }
  const smtp = await getSmtp();
  if(smtp){
    try{
      const info = await smtp.sendMail({
        from: FROM_EMAIL, to: para, subject: assunto, html, text: texto
      });
      return { ok:true, provider:'smtp', id: info.messageId };
    }catch(err){
      console.warn('[Email] SMTP falhou:', err.message);
    }
  }
  console.info(`[Email-DRY] Para: ${para} · Assunto: ${assunto}\n${texto||html}`);
  return { ok:false, provider:'console', error:'Nenhum provider configurado.' };
}

/* ---------- Templates institucionais ---------- */

export async function notificarCADDdeNovaSubmissao(coordEmail, docenteNome, ciclo, link){
  return enviarEmail({
    para: coordEmail,
    assunto: `[CADD ISPTLO] Nova submissão de avaliação — ${docenteNome}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#1a1a1a">
        <div style="background:linear-gradient(135deg,#0B2545,#143266);color:#fff;padding:18px;border-radius:10px 10px 0 0">
          <h2 style="margin:0">🔔 Nova submissão CADD ISPTLO</h2>
          <div style="font-size:.85rem;opacity:.85;margin-top:4px;font-style:italic">«Gestão Inteligente para Instituições de Excelência»</div>
        </div>
        <div style="background:#fff;border:1px solid #e5e1d6;border-top:none;padding:20px;border-radius:0 0 10px 10px">
          <p>Foi recebida uma nova auto-avaliação na Plataforma CADD:</p>
          <ul>
            <li><strong>Docente:</strong> ${docenteNome}</li>
            <li><strong>Ciclo avaliativo:</strong> ${ciclo}</li>
            <li><strong>Recebida em:</strong> ${new Date().toLocaleString('pt-PT')}</li>
          </ul>
          <p>Aguarda atribuição a avaliador e validação da CADD.</p>
          ${link ? `<p style="margin-top:14px"><a href="${link}" style="background:#C9A14A;color:#0B2545;padding:10px 18px;text-decoration:none;border-radius:6px;font-weight:700">Aceder à plataforma →</a></p>` : ''}
          <hr style="border:none;border-top:1px solid #e5e1d6;margin:20px 0">
          <div style="font-size:.75rem;color:#5a6470;text-align:center">
            <strong>ILR : Academic Solutions</strong> · Plataforma CADD ISPTLO · <em>Ph.D. Ideleichy Lombillo Rivero</em>
          </div>
        </div>
      </div>`,
    texto: `Nova submissão CADD: ${docenteNome} — Ciclo ${ciclo}. Aceda à plataforma para validar.`
  });
}

export async function notificarDocenteValidacao(docenteEmail, docenteNome, classificacao, link){
  return enviarEmail({
    para: docenteEmail,
    assunto: `[CADD ISPTLO] Avaliação validada — ${classificacao}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#0B2545,#143266);color:#fff;padding:18px;border-radius:10px 10px 0 0">
          <h2 style="margin:0">📋 Resultado da sua avaliação</h2>
        </div>
        <div style="background:#fff;border:1px solid #e5e1d6;border-top:none;padding:20px;border-radius:0 0 10px 10px">
          <p>Caro(a) <strong>${docenteNome}</strong>,</p>
          <p>A sua auto-avaliação foi validada pela Comissão de Avaliação de Desempenho Docente (CADD).</p>
          <div style="background:#fdf6e3;border:2px solid #C9A14A;padding:14px;border-radius:8px;text-align:center;margin:14px 0">
            <div style="color:#5a6470;font-size:.85rem">Classificação atribuída</div>
            <div style="font-size:1.5rem;font-weight:700;color:#0B2545;margin-top:6px">${classificacao}</div>
          </div>
          <p>Para consultar o detalhe e o relatório completo, aceda à plataforma com as suas credenciais habituais.</p>
          ${link ? `<p style="margin-top:14px;text-align:center"><a href="${link}" style="background:#C9A14A;color:#0B2545;padding:10px 18px;text-decoration:none;border-radius:6px;font-weight:700">Ver relatório →</a></p>` : ''}
          <p style="font-size:.85rem;color:#5a6470;margin-top:18px;font-style:italic">A homologação final pelo Presidente do ISPTLO ainda está pendente. Será notificado(a) novamente quando concluída.</p>
        </div>
      </div>`,
    texto: `Caro(a) ${docenteNome}, a sua avaliação CADD foi validada. Classificação: ${classificacao}.`
  });
}

export async function notificarCriacaoAvaliador(email, nome, bi, pwd, urlPortal){
  return enviarEmail({
    para: email,
    assunto: `[CADD ISPTLO] Credenciais de Avaliador`,
    html: `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#0B2545,#143266);color:#fff;padding:18px;border-radius:10px 10px 0 0">
          <h2 style="margin:0">🔐 Acesso à Plataforma CADD</h2>
        </div>
        <div style="background:#fff;border:1px solid #e5e1d6;border-top:none;padding:20px;border-radius:0 0 10px 10px">
          <p>Caro(a) <strong>${nome}</strong>,</p>
          <p>Foi nomeado(a) <strong>Avaliador(a) da CADD do ISPTLO</strong>. As suas credenciais de acesso são:</p>
          <div style="background:#fdf6e3;border:2px dashed #C9A14A;padding:14px;border-radius:8px;font-family:'Courier New',monospace;text-align:center;margin:14px 0">
            <div style="color:#5a6470;font-size:.78rem">URL da plataforma</div>
            <div style="margin:4px 0 12px"><a href="${urlPortal}">${urlPortal}</a></div>
            <div style="color:#5a6470;font-size:.78rem">N.º BI</div>
            <div style="font-weight:700;color:#0B2545;font-size:1.1rem;margin:4px 0 12px">${bi}</div>
            <div style="color:#5a6470;font-size:.78rem">Palavra-passe</div>
            <div style="font-weight:700;color:#0B2545;font-size:1.1rem;margin-top:4px">${pwd}</div>
          </div>
          <p style="background:#fdf3ec;border-left:4px solid #a14a2c;padding:10px 14px;border-radius:6px;font-size:.88rem">
            ⚠ <strong>Por segurança</strong>, altere a palavra-passe no primeiro acesso.
            <strong>Não partilhe</strong> estas credenciais com terceiros.
          </p>
        </div>
      </div>`,
    texto: `Acesso CADD ISPTLO: ${urlPortal} | BI: ${bi} | Pwd: ${pwd}`
  });
}
