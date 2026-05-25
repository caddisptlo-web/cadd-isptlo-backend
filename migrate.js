import Database from "better-sqlite3";

const db = new Database("./data/cadd.db");

const cols = db.prepare("PRAGMA table_info(avaliacoes)").all();
const existing = cols.map(c => c.name);

function add(name, sql) {
  if (!existing.includes(name)) {
    console.log("Creando:", name);
    db.exec(sql);
  } else {
    console.log("Existe:", name);
  }
}

add("estado", "ALTER TABLE avaliacoes ADD COLUMN estado TEXT DEFAULT 'submetido'");
add("parecer_json", "ALTER TABLE avaliacoes ADD COLUMN parecer_json TEXT");
add("homologado_em", "ALTER TABLE avaliacoes ADD COLUMN homologado_em TEXT");
add("homologado_por", "ALTER TABLE avaliacoes ADD COLUMN homologado_por TEXT");

console.log("Migración OK");
