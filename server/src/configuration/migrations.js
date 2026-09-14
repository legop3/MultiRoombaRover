// Configuration Database Migrations
// Purpose: Applies ordered, transactional schema changes to the configuration and administration database.
// Scope: Owns database structure only; configuration-document evolution belongs to the ordered definition and validation.
const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE configuration_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        source TEXT NOT NULL
      );

      CREATE TABLE configuration_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        active_revision_id INTEGER NOT NULL REFERENCES configuration_revisions(id)
      );

      CREATE TABLE administrators (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        discord_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('admin', 'lockdown')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE administrative_audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        details_json TEXT NOT NULL
      );
    `,
  },
];

function applySchemaMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => Number(row.version)));
  const record = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');

  migrations.forEach((migration) => {
    if (applied.has(migration.version)) return;
    /*
      Schema SQL and its version marker are one transaction. A process failure
      can therefore retry the migration cleanly instead of finding a partially
      changed database whose version incorrectly appears current.
    */
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, Date.now());
    })();
  });
}

module.exports = {
  migrations,
  applySchemaMigrations,
};
