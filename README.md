# Backend Plataforma CADD ISPTLO

**Servidor institucional** — Node.js + Express + SQLite (`better-sqlite3`)

> Soluções **ILR : Academic Solutions** · Versão 1.0

---

## 1. Requisitos

- **Node.js 18+** instalado no servidor (Linux, Windows ou macOS).
- Acesso à porta TCP 4000 (ou outra à escolha).
- Cerca de 50 MB de espaço em disco (cresce ~10 KB por avaliação).

---

## 2. Instalação rápida

```bash
cd backend
npm install
npm run init-db
npm run create-token -- --role admin --label "Coordenador CADD"
npm start
```

O servidor fica disponível em **http://0.0.0.0:4000** (acessível pela rede do
ISPTLO). Em produção recomendamos colocar atrás de um reverse-proxy (nginx,
Caddy) com **HTTPS**.

---

## 3. Modelo de dados

```
avaliacoes (id, bi, ciclo, nome, email, dei, categoria, grau, regime,
            total, nivel, payload, submitted_by, created_at, updated_at)
tokens     (id, token, role, label, bi, active, created_at)
audit_log  (id, actor, action, target, payload, ts)
```

Índice único: `(bi, ciclo)` — uma avaliação por docente por ciclo.

---

## 4. Endpoints REST

Autenticação por cabeçalho `X-CADD-Token: <token>`.

| Método | Endpoint | Papel | Descrição |
|--------|----------|-------|-----------|
| GET    | `/api/status` | público | Verificação de saúde |
| POST   | `/api/avaliacoes` | docente, cadd, admin | Submeter / actualizar avaliação |
| GET    | `/api/avaliacoes` | cadd, admin | Listar avaliações (filtros: `ciclo`, `dei`) |
| GET    | `/api/avaliacoes/:id` | dono ou cadd/admin | Detalhe |
| DELETE | `/api/avaliacoes/:id` | admin | Apagar |
| GET    | `/api/ciclos` | qualquer | Listar ciclos com contagens |
| GET    | `/api/resumo?ciclo=...` | cadd, admin | Estatísticas agregadas |

### Exemplo — submeter

```bash
curl -X POST http://servidor.isptlo.ao:4000/api/avaliacoes \
  -H "Content-Type: application/json" \
  -H "X-CADD-Token: <token>" \
  -d @CADD_Joao_Silva_2026-2027.json
```

### Exemplo — listar

```bash
curl http://servidor.isptlo.ao:4000/api/avaliacoes?ciclo=2026%20%E2%80%94%202027 \
  -H "X-CADD-Token: <token-cadd>"
```

---

## 5. Tipos de token (papéis)

- **`docente`** — pode submeter a sua própria avaliação (filtrada pelo BI
  associado ao token) e consultá-la. Não vê dados de colegas.
- **`cadd`** — vê todas as avaliações, agregados, dashboard.
- **`admin`** — tudo o anterior + apagar registos + criar tokens.

Criar tokens:

```bash
npm run create-token -- --role docente --label "João Silva" --bi 003456789LA042
npm run create-token -- --role cadd    --label "Avaliador Maria"
npm run create-token -- --role admin   --label "Coordenador CADD"
```

> Os tokens são gerados com `crypto.randomBytes(24)` e guardados em texto
> simples na BD — proteja o ficheiro `data/cadd.db` com permissões restritivas
> (chmod 600).

---

## 6. Backups

```bash
npm run backup
```

Recomendado configurar um cron diário:

```cron
0 2 * * *  cd /caminho/backend && npm run backup
```

---

## 7. Variáveis de ambiente

| Variável     | Default            | Descrição |
|--------------|--------------------|-----------|
| `CADD_PORT`  | `4000`             | Porta TCP |
| `CADD_HOST`  | `0.0.0.0`          | Interface a escutar |
| `CADD_DB`    | `./data/cadd.db`   | Caminho do ficheiro SQLite |

---

## 8. Frontend

Os ficheiros HTML (`index.html`, `dashboard.html`) são servidos **diretamente
pelo backend** (rota `/`). Para ligar o frontend ao backend:

1. Editar `index.html` e `dashboard.html`.
2. Procurar a linha `const BACKEND_URL = "";`
3. Substituir por `const BACKEND_URL = "http://servidor.isptlo.ao:4000";`
4. (Opcional) injectar token via `localStorage.setItem('caddToken', '...')`.

A ligação ao backend é **opcional**. Sem `BACKEND_URL` configurado, a
plataforma funciona em modo offline (LocalStorage + JSON).

---

## 9. Segurança em produção

- Colocar atrás de **HTTPS** (Let's Encrypt + nginx/Caddy).
- Restringir `cors` a um único domínio em `server.js`.
- Permissões `chmod 600` no ficheiro `data/cadd.db`.
- Backups encriptados se contiverem dados pessoais (LGPD/GDPR).
- Rotação periódica de tokens — basta marcar `active=0` na BD.
