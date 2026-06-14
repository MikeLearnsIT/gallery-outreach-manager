const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'database.sqlite');
const GALLERIES_JSON = path.join(DATA_DIR, 'galleries.json');
const SEND_LOG_JSON = path.join(DATA_DIR, 'send_log.json');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let dbInstance = null;
let dbInitPromise = null;

async function getDb() {
  if (dbInstance) return dbInstance;

  if (!dbInitPromise) {
    dbInitPromise = initializeDb().catch(err => {
      dbInitPromise = null;
      throw err;
    });
  }

  return dbInitPromise;
}

async function initializeDb() {
  const db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database
  });

  await db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS galleries (
      id TEXT PRIMARY KEY,
      name TEXT,
      city TEXT,
      address TEXT,
      website TEXT,
      phone TEXT,
      emails TEXT,
      rating REAL,
      place_id TEXT,
      google_maps_url TEXT,
      categories TEXT,
      status TEXT,
      notes TEXT,
      last_scraped_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS send_log (
      id TEXT PRIMARY KEY,
      gallery_id TEXT,
      email_to TEXT,
      template TEXT,
      status TEXT,
      sent_at TEXT,
      opened_at TEXT,
      click_count INTEGER DEFAULT 0,
      message_id TEXT,
      reply_token TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS replies (
      id TEXT PRIMARY KEY,
      gallery_id TEXT NOT NULL,
      send_log_id TEXT,
      from_email TEXT,
      from_name TEXT,
      subject TEXT,
      body_text TEXT,
      snippet TEXT,
      classification TEXT,
      status TEXT,
      received_at TEXT,
      handled_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE,
      FOREIGN KEY (send_log_id) REFERENCES send_log(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS followups (
      id TEXT PRIMARY KEY,
      gallery_id TEXT NOT NULL,
      reply_id TEXT,
      title TEXT,
      note TEXT,
      due_at TEXT,
      status TEXT,
      completed_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE,
      FOREIGN KEY (reply_id) REFERENCES replies(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await ensureColumn(db, 'galleries', 'last_scraped_at', 'last_scraped_at TEXT');
  await ensureColumn(db, 'send_log', 'opened_at', 'opened_at TEXT');
  await ensureColumn(db, 'send_log', 'click_count', 'click_count INTEGER DEFAULT 0');
  await ensureColumn(db, 'send_log', 'message_id', 'message_id TEXT');
  await ensureColumn(db, 'send_log', 'reply_token', 'reply_token TEXT');

  await migrateJsonData(db);
  await createIndexes(db);

  dbInstance = db;
  return dbInstance;
}

async function ensureColumn(db, tableName, columnName, columnDefinition) {
  const columns = await db.all(`PRAGMA table_info(${tableName})`);
  if (!columns.some(col => col.name === columnName)) {
    await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
    console.log(`[DB] Added ${tableName}.${columnName} column`);
  }
}

async function createIndexes(db) {
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_galleries_place_id ON galleries(place_id);
    CREATE INDEX IF NOT EXISTS idx_galleries_name_city ON galleries(name, city);
    CREATE INDEX IF NOT EXISTS idx_galleries_status ON galleries(status);
    CREATE INDEX IF NOT EXISTS idx_galleries_created_at ON galleries(created_at);
    CREATE INDEX IF NOT EXISTS idx_galleries_last_scraped_at ON galleries(last_scraped_at);
    CREATE INDEX IF NOT EXISTS idx_send_log_gallery_id ON send_log(gallery_id);
    CREATE INDEX IF NOT EXISTS idx_send_log_status_sent_at ON send_log(status, sent_at);
    CREATE INDEX IF NOT EXISTS idx_send_log_opened_at ON send_log(opened_at);
    CREATE INDEX IF NOT EXISTS idx_send_log_message_id ON send_log(message_id);
    CREATE INDEX IF NOT EXISTS idx_send_log_reply_token ON send_log(reply_token);
    CREATE INDEX IF NOT EXISTS idx_replies_gallery_id ON replies(gallery_id);
    CREATE INDEX IF NOT EXISTS idx_replies_send_log_id ON replies(send_log_id);
    CREATE INDEX IF NOT EXISTS idx_replies_status_received_at ON replies(status, received_at);
    CREATE INDEX IF NOT EXISTS idx_replies_classification ON replies(classification);
    CREATE INDEX IF NOT EXISTS idx_followups_gallery_id ON followups(gallery_id);
    CREATE INDEX IF NOT EXISTS idx_followups_reply_id ON followups(reply_id);
    CREATE INDEX IF NOT EXISTS idx_followups_status_due_at ON followups(status, due_at);
  `);
}

async function migrateJsonData(db) {
  // Migrate galleries
  const { count } = await db.get('SELECT COUNT(*) as count FROM galleries');
  if (count === 0 && fs.existsSync(GALLERIES_JSON)) {
    console.log(`[DB Migration] Found ${GALLERIES_JSON}. Migrating to SQLite...`);
    try {
      const rawData = fs.readFileSync(GALLERIES_JSON, 'utf-8');
      if (rawData.trim()) {
        const galleries = JSON.parse(rawData);
        console.log(`[DB Migration] Parsed ${galleries.length} galleries. Inserting into DB...`);
        
        await db.run('BEGIN TRANSACTION');
        const stmt = await db.prepare(`
          INSERT INTO galleries 
          (id, name, city, address, website, phone, emails, rating, place_id, google_maps_url, categories, status, notes, created_at, updated_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        for (const g of galleries) {
          await stmt.run(
            g.id,
            g.name || '',
            g.city || '',
            g.address || '',
            g.website || '',
            g.phone || '',
            JSON.stringify(g.emails || []),
            g.rating || null,
            g.place_id || null,
            g.google_maps_url || '',
            JSON.stringify(g.categories || []),
            g.status || 'new',
            g.notes || '',
            g.created_at || new Date().toISOString(),
            g.updated_at || new Date().toISOString()
          );
        }
        await stmt.finalize();
        await db.run('COMMIT');
        console.log(`[DB Migration] SUCCESS: ${galleries.length} galleries migrated.`);
      }
    } catch (err) {
      await db.run('ROLLBACK');
      console.error('[DB Migration] ERROR migrating galleries:', err);
    }
  }

  // Migrate send_log
  const { count: logCount } = await db.get('SELECT COUNT(*) as count FROM send_log');
  if (logCount === 0 && fs.existsSync(SEND_LOG_JSON)) {
    console.log(`[DB Migration] Found ${SEND_LOG_JSON}. Migrating to SQLite...`);
    try {
      const rawData = fs.readFileSync(SEND_LOG_JSON, 'utf-8');
      if (rawData.trim()) {
        const logs = JSON.parse(rawData);
        console.log(`[DB Migration] Parsed ${logs.length} logs. Inserting into DB...`);

        await db.run('BEGIN TRANSACTION');
        const stmt = await db.prepare(`
          INSERT INTO send_log 
          (id, gallery_id, email_to, template, status, sent_at, error) 
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const l of logs) {
          await stmt.run(
            l.id,
            l.gallery_id,
            l.email_to,
            l.template,
            l.status,
            l.sent_at || new Date().toISOString(),
            l.error || null
          );
        }
        await stmt.finalize();
        await db.run('COMMIT');
        console.log(`[DB Migration] SUCCESS: ${logs.length} logs migrated.`);
      }
    } catch (err) {
      await db.run('ROLLBACK');
      console.error('[DB Migration] ERROR migrating logs:', err);
    }
  }
}

module.exports = { getDb };
