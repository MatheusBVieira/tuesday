import type Database from 'better-sqlite3';
import type { Driver } from './driver';
import { POSTGRES_MIGRATIONS, POSTGRES_SCHEMA, POSTGRES_SCHEMA_VERSION } from './schema-postgres';
import { ensureCorePeople, seedDemo } from './seed';
import type { SqliteDriver } from './sqlite';

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

type Migration = string | ((db: Database.Database) => void);

/**
 * Cada entrada é uma versão do schema do SQLite (PRAGMA user_version). Nunca edite uma migração já publicada —
 * adicione outra, e a equivalente em POSTGRES_MIGRATIONS (schema-postgres.ts).
 */
const MIGRATIONS: Migration[] = [
  // v1 — quadros, grupos, colunas, itens, atualizações e atividades
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE people (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT,
    color      TEXT NOT NULL,
    is_agent   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE boards (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    position         REAL NOT NULL DEFAULT 0,
    next_item_number INTEGER NOT NULL DEFAULT 1,
    settings         TEXT NOT NULL DEFAULT '{}',
    created_at       TEXT NOT NULL DEFAULT ${NOW},
    updated_at       TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE board_groups (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL,
    position   REAL NOT NULL DEFAULT 0,
    collapsed  INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX idx_groups_board ON board_groups(board_id, position);

  CREATE TABLE board_columns (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    type       TEXT NOT NULL,
    settings   TEXT NOT NULL DEFAULT '{}',
    width      INTEGER NOT NULL DEFAULT 140,
    position   REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX idx_columns_board ON board_columns(board_id, position);

  CREATE TABLE items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id        INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    group_id        INTEGER NOT NULL REFERENCES board_groups(id) ON DELETE CASCADE,
    number          INTEGER NOT NULL,
    name            TEXT NOT NULL,
    position        REAL NOT NULL DEFAULT 0,
    kanban_position REAL NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT ${NOW},
    updated_at      TEXT NOT NULL DEFAULT ${NOW},
    deleted_at      TEXT
  );
  CREATE INDEX idx_items_group ON items(group_id, position);
  CREATE INDEX idx_items_board ON items(board_id, deleted_at);
  CREATE UNIQUE INDEX idx_items_number ON items(board_id, number);

  CREATE TABLE item_values (
    item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    column_id  INTEGER NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (item_id, column_id)
  ) WITHOUT ROWID;
  CREATE INDEX idx_values_column ON item_values(column_id);

  CREATE TABLE updates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    author_id  INTEGER REFERENCES people(id) ON DELETE SET NULL,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW},
    updated_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX idx_updates_item ON updates(item_id, created_at);

  CREATE TABLE activity (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    item_id    INTEGER REFERENCES items(id) ON DELETE SET NULL,
    item_name  TEXT,
    actor_id   INTEGER REFERENCES people(id) ON DELETE SET NULL,
    source     TEXT NOT NULL DEFAULT 'user',
    action     TEXT NOT NULL,
    data       TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX idx_activity_board ON activity(board_id, id);
  CREATE INDEX idx_activity_item ON activity(item_id, id);
  `,

  // v2 — projetos (espaços de trabalho), opcionalmente vinculados a uma pasta local
  (db) => {
    db.exec(`
      CREATE TABLE projects (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        color      TEXT NOT NULL,
        folder     TEXT,
        position   REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      ALTER TABLE boards ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;
      CREATE INDEX idx_boards_project ON boards(project_id, position);
    `);
    const boards = (db.prepare('SELECT COUNT(*) AS n FROM boards').get() as { n: number }).n;
    if (boards > 0) {
      const projectId = db.prepare("INSERT INTO projects (name, color, position) VALUES ('Geral', '#0073ea', 1000)").run().lastInsertRowid;
      db.prepare('UPDATE boards SET project_id = ? WHERE project_id IS NULL').run(projectId);
    }
  },

  // v3 — integração com Git: commits que citam itens (ex.: TUE-012)
  (db) => {
    db.exec(`
      ALTER TABLE projects ADD COLUMN git_state TEXT NOT NULL DEFAULT '{}';

      CREATE TABLE commits (
        project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        hash         TEXT NOT NULL,
        subject      TEXT NOT NULL,
        body         TEXT NOT NULL DEFAULT '',
        author_name  TEXT NOT NULL,
        author_email TEXT NOT NULL DEFAULT '',
        committed_at TEXT NOT NULL,
        PRIMARY KEY (project_id, hash)
      ) WITHOUT ROWID;

      CREATE TABLE item_commits (
        item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL,
        hash       TEXT NOT NULL,
        closed     INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT ${NOW},
        PRIMARY KEY (item_id, hash)
      ) WITHOUT ROWID;
      CREATE INDEX idx_item_commits_project ON item_commits(project_id, hash);
    `);
    // Pastas já vinculadas: só commits a partir de agora concluem itens (o histórico antigo apenas é ligado).
    db.prepare(`UPDATE projects SET git_state = json_object('initializedAt', ${NOW}) WHERE folder IS NOT NULL`).run();
  },

  // v4 — a pasta do projeto pode ter vários repositórios: cada commit guarda de qual veio
  (db) => {
    db.exec(`ALTER TABLE commits ADD COLUMN repo TEXT NOT NULL DEFAULT ''`);
    db.prepare(
      `UPDATE commits SET repo = COALESCE((SELECT p.folder FROM projects p WHERE p.id = commits.project_id), '') WHERE repo = ''`,
    ).run();
    // O formato do estado do Git mudou (um repositório → vários): relê tudo na próxima sincronização.
    db.prepare(
      `UPDATE projects SET git_state = json_remove(git_state, '$.signature', '$.remote', '$.isRepo') WHERE json_valid(git_state)`,
    ).run();
  },

  // v5 — subitens (checklist) dos itens
  `
  CREATE TABLE subitems (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    position   REAL NOT NULL DEFAULT 0,
    done_at    TEXT,
    done_by    INTEGER REFERENCES people(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW},
    updated_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX idx_subitems_item ON subitems(item_id, position);
  `,

  // v6 — TODO/FIXME do código importados como itens (a identidade não depende do número da linha)
  `
  CREATE TABLE code_todos (
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    path        TEXT NOT NULL,
    line        INTEGER NOT NULL,
    col         INTEGER NOT NULL DEFAULT 1,
    tag         TEXT NOT NULL,
    text        TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT ${NOW},
    removed_at  TEXT,
    PRIMARY KEY (project_id, fingerprint)
  ) WITHOUT ROWID;
  CREATE INDEX idx_code_todos_item ON code_todos(item_id);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

function migrateSqlite(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > MIGRATIONS.length) throw new Error(`O banco é de uma versão mais nova do tuesday (schema ${current}). Atualize o tuesday.`);
  for (let version = current; version < MIGRATIONS.length; version++) {
    const migration = MIGRATIONS[version];
    if (typeof migration === 'string') db.exec(migration);
    else migration(db);
    db.pragma(`user_version = ${version + 1}`);
  }
}

function migratePostgres(db: Driver): void {
  const latest = POSTGRES_MIGRATIONS.reduce((v, [n]) => Math.max(v, n), POSTGRES_SCHEMA_VERSION);
  if (latest !== MIGRATIONS.length)
    throw new Error(`Schema do PostgreSQL na versão ${latest}, do SQLite na ${MIGRATIONS.length}: falta a migração equivalente.`);
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  let current = row ? Number(row.value) : 0;
  if (current > latest) throw new Error(`O banco é de uma versão mais nova do tuesday (schema ${current}). Atualize o tuesday.`);
  if (current === 0) {
    db.exec(POSTGRES_SCHEMA);
    current = POSTGRES_SCHEMA_VERSION;
  }
  for (const [version, sql] of POSTGRES_MIGRATIONS) {
    if (version <= current) continue;
    db.exec(sql);
    current = version;
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(
    String(current),
  );
}

/** Cria ou atualiza o schema, garante as pessoas "Você" e "Claude" e, no primeiro uso, o projeto de exemplo. */
export function migrate(db: Driver): void {
  db.transaction(() => {
    if (db.dialect === 'sqlite') migrateSqlite((db as SqliteDriver).raw);
    else migratePostgres(db);
    const ids = ensureCorePeople(db);
    const seeded = db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get();
    if (!seeded) {
      if (process.env.TUESDAY_NO_SEED !== '1') seedDemo(db, ids);
      db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1') ON CONFLICT (key) DO UPDATE SET value = excluded.value").run();
    }
  });
}
