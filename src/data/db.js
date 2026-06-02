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

async function getDb() {
  if (dbInstance) return dbInstance;

  dbInstance = await open({
    filename: DB_FILE,
    driver: sqlite3.Database
  });

  await dbInstance.exec(`
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
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Simple migration to add last_scraped_at if it doesn't exist
  try {
    await dbInstance.exec('ALTER TABLE galleries ADD COLUMN last_scraped_at TEXT');
  } catch (err) {}

  try {
    await dbInstance.exec('ALTER TABLE send_log ADD COLUMN opened_at TEXT');
    await dbInstance.exec('ALTER TABLE send_log ADD COLUMN click_count INTEGER DEFAULT 0');
    console.log('[DB] Added tracking columns to send_log table');
  } catch (err) {}

  await migrateJsonData();

  return dbInstance;
}

async function migrateJsonData() {
  // Migrate galleries
  const { count } = await dbInstance.get('SELECT COUNT(*) as count FROM galleries');
  if (count === 0 && fs.existsSync(GALLERIES_JSON)) {
    console.log(`[DB Migration] Found ${GALLERIES_JSON}. Migrating to SQLite...`);
    try {
      const rawData = fs.readFileSync(GALLERIES_JSON, 'utf-8');
      if (rawData.trim()) {
        const galleries = JSON.parse(rawData);
        console.log(`[DB Migration] Parsed ${galleries.length} galleries. Inserting into DB...`);
        
        await dbInstance.run('BEGIN TRANSACTION');
        const stmt = await dbInstance.prepare(`
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
        await dbInstance.run('COMMIT');
        console.log(`[DB Migration] SUCCESS: ${galleries.length} galleries migrated.`);
      }
    } catch (err) {
      await dbInstance.run('ROLLBACK');
      console.error('[DB Migration] ERROR migrating galleries:', err);
    }
  }

  // Migrate send_log
  const { count: logCount } = await dbInstance.get('SELECT COUNT(*) as count FROM send_log');
  if (logCount === 0 && fs.existsSync(SEND_LOG_JSON)) {
    console.log(`[DB Migration] Found ${SEND_LOG_JSON}. Migrating to SQLite...`);
    try {
      const rawData = fs.readFileSync(SEND_LOG_JSON, 'utf-8');
      if (rawData.trim()) {
        const logs = JSON.parse(rawData);
        console.log(`[DB Migration] Parsed ${logs.length} logs. Inserting into DB...`);

        await dbInstance.run('BEGIN TRANSACTION');
        const stmt = await dbInstance.prepare(`
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
        await dbInstance.run('COMMIT');
        console.log(`[DB Migration] SUCCESS: ${logs.length} logs migrated.`);
      }
    } catch (err) {
      await dbInstance.run('ROLLBACK');
      console.error('[DB Migration] ERROR migrating logs:', err);
    }
  }
}

module.exports = { getDb };
