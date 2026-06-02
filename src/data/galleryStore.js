const { getDb } = require('./db');

class GalleryStore {
  /**
   * Generate a simple unique ID
   */
  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Helper to parse JSON fields
   */
  _parseRow(row) {
    if (!row) return null;
    return {
      ...row,
      emails: row.emails ? JSON.parse(row.emails) : [],
      categories: row.categories ? JSON.parse(row.categories) : []
    };
  }

  // ─── Gallery CRUD ──────────────────────────────────────────

  /**
   * Add a gallery (deduplicates by place_id or name+city)
   */
  async addGallery(gallery) {
    const db = await getDb();
    
    // Check for duplicates
    let exists = null;
    if (gallery.place_id) {
      exists = await db.get('SELECT * FROM galleries WHERE place_id = ?', [gallery.place_id]);
    }
    if (!exists && gallery.name && gallery.city) {
      exists = await db.get('SELECT * FROM galleries WHERE name = ? AND city = ?', [gallery.name, gallery.city]);
    }

    if (exists) {
      const parsedExists = this._parseRow(exists);
      
      // Merge emails: keep existing ones and add any new ones found
      const mergedEmails = [...new Set([...(parsedExists.emails || []), ...(gallery.emails || [])])];
      
      // Update core info from Google, but keep existing values if Google doesn't provide them
      await db.run(
        `UPDATE galleries SET 
          name = ?,
          address = ?,
          website = ?,
          phone = ?,
          emails = ?,
          rating = ?,
          google_maps_url = ?,
          categories = ?,
          last_scraped_at = ?,
          updated_at = ?
        WHERE id = ?`,
        [
          gallery.name || exists.name,
          gallery.address || exists.address,
          gallery.website || exists.website,
          gallery.phone || exists.phone,
          JSON.stringify(mergedEmails),
          gallery.rating ?? exists.rating,
          gallery.google_maps_url || exists.google_maps_url,
          gallery.categories ? JSON.stringify(gallery.categories) : exists.categories,
          gallery.last_scraped_at || exists.last_scraped_at,
          new Date().toISOString(),
          exists.id
        ]
      );
      return { action: 'updated', gallery: this._parseRow(await db.get('SELECT * FROM galleries WHERE id = ?', [exists.id])) };
    }

    const newId = this._generateId();
    await db.run(
      `INSERT INTO galleries (id, name, city, address, website, phone, emails, rating, place_id, google_maps_url, categories, status, notes, last_scraped_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId,
        gallery.name || '',
        gallery.city || '',
        gallery.address || '',
        gallery.website || '',
        gallery.phone || '',
        JSON.stringify(gallery.emails || []),
        gallery.rating || null,
        gallery.place_id || null,
        gallery.google_maps_url || '',
        JSON.stringify(gallery.categories || []),
        'new',
        gallery.notes || '',
        gallery.last_scraped_at || null,
        new Date().toISOString(),
        new Date().toISOString()
      ]
    );

    return { action: 'added', gallery: this._parseRow(await db.get('SELECT * FROM galleries WHERE id = ?', [newId])) };
  }

  /**
   * Batch add galleries
   */
  async addMany(galleries) {
    let added = 0;
    let updated = 0;
    for (const g of galleries) {
      const res = await this.addGallery(g);
      if (res.action === 'added') added++;
      if (res.action === 'updated') updated++;
    }
    const db = await getDb();
    const { total } = await db.get('SELECT COUNT(*) as total FROM galleries');
    return { added, updated, total };
  }

  /**
   * Get all galleries with optional filters
   */
  async getAll(filters = {}) {
    const db = await getDb();
    let query = `
      SELECT g.*, 
             MAX(l.opened_at) as latest_open,
             SUM(CASE WHEN l.opened_at IS NOT NULL THEN 1 ELSE 0 END) as open_count
      FROM galleries g
      LEFT JOIN send_log l ON g.id = l.gallery_id
      WHERE 1=1`;
    const params = [];

    if (filters.city) {
      query += ' AND LOWER(city) LIKE ?';
      params.push(`%${filters.city.toLowerCase()}%`);
    }
    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.hasEmail !== undefined) {
      if (filters.hasEmail) {
        query += " AND emails != '[]' AND emails IS NOT NULL";
      } else {
        query += " AND (emails = '[]' OR emails IS NULL)";
      }
    }
    if (filters.needsScrape) {
      query += " AND (last_scraped_at IS NULL OR last_scraped_at = '')";
    }
    if (filters.category) {
      query += ' AND categories LIKE ?';
      params.push(`%${filters.category}%`);
    }
    if (filters.search) {
      const term = `%${filters.search.toLowerCase()}%`;
      query += ' AND (LOWER(name) LIKE ? OR LOWER(city) LIKE ? OR LOWER(address) LIKE ?)';
      params.push(term, term, term);
    }

    query += ' GROUP BY g.id';

    if (filters.sortBy) {
      const dir = filters.sortDir === 'desc' ? 'DESC' : 'ASC';
      const safeSortBy = ['name', 'city', 'status', 'created_at'].includes(filters.sortBy) ? filters.sortBy : 'created_at';
      query += ` ORDER BY ${safeSortBy} ${dir}`;
    }

    const rows = await db.all(query, params);
    return rows.map(r => this._parseRow(r));
  }

  /**
   * Get a single gallery by ID
   */
  async getById(id) {
    const db = await getDb();
    const row = await db.get('SELECT * FROM galleries WHERE id = ?', [id]);
    return this._parseRow(row);
  }

  /**
   * Update a gallery
   */
  async update(id, updates) {
    const db = await getDb();
    const row = await db.get('SELECT * FROM galleries WHERE id = ?', [id]);
    if (!row) return null;

    const setClauses = [];
    const params = [];
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'id') continue;
      setClauses.push(`${key} = ?`);
      if (key === 'emails' || key === 'categories') {
        params.push(JSON.stringify(value));
      } else {
        params.push(value);
      }
    }
    
    if (setClauses.length === 0) return this._parseRow(row);
    
    setClauses.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    await db.run(`UPDATE galleries SET ${setClauses.join(', ')} WHERE id = ?`, params);
    return await this.getById(id);
  }

  /**
   * Delete a gallery
   */
  async delete(id) {
    const db = await getDb();
    const res = await db.run('DELETE FROM galleries WHERE id = ?', [id]);
    return res.changes > 0;
  }

  // ─── Send Log ──────────────────────────────────────────────

  /**
   * Log a sent email
   */
  async logSend(galleryId, emailTo, templateName, status = 'sent') {
    const db = await getDb();
    const entry = {
      id: this._generateId(),
      gallery_id: galleryId,
      email_to: emailTo,
      template: templateName,
      status,
      sent_at: new Date().toISOString(),
      error: null
    };

    await db.run(`
      INSERT INTO send_log (id, gallery_id, email_to, template, status, sent_at, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entry.id, entry.gallery_id, entry.email_to, entry.template, entry.status, entry.sent_at, entry.error]
    );

    if (status === 'sent') {
      await this.update(galleryId, { status: 'contacted' });
    }
    return entry;
  }

  /**
   * Mark an email as opened
   */
  async markAsOpened(logId) {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.run(
      'UPDATE send_log SET opened_at = COALESCE(opened_at, ?), click_count = click_count + 1 WHERE id = ?',
      [now, logId]
    );
    return true;
  }

  /**
   * Get send log
   */
  async getSendLog(filters = {}) {
    const db = await getDb();
    let query = `
      SELECT l.*, g.name as gallery_name
      FROM send_log l
      LEFT JOIN galleries g ON l.gallery_id = g.id
      WHERE 1=1`;
    const params = [];
    if (filters.galleryId) {
      query += ' AND l.gallery_id = ?';
      params.push(filters.galleryId);
    }
    if (filters.status) {
      query += ' AND l.status = ?';
      params.push(filters.status);
    }
    query += ' ORDER BY l.sent_at DESC';
    return await db.all(query, params);
  }

  /**
   * Count emails sent today
   */
  async getTodaySendCount() {
    const db = await getDb();
    const today = new Date().toISOString().split('T')[0];
    const { count } = await db.get("SELECT COUNT(*) as count FROM send_log WHERE status = 'sent' AND sent_at LIKE ?", [`${today}%`]);
    return count;
  }

  // ─── Statistics ────────────────────────────────────────────

  /**
   * Get summary statistics
   */
  async getStats() {
    const db = await getDb();
    
    const { total } = await db.get('SELECT COUNT(*) as total FROM galleries');
    const { withEmail } = await db.get("SELECT COUNT(*) as withEmail FROM galleries WHERE emails != '[]' AND emails IS NOT NULL");
    
    const statusRows = await db.all('SELECT status, COUNT(*) as count FROM galleries GROUP BY status');
    const byStatus = {};
    for (const r of statusRows) {
      byStatus[r.status] = r.count;
    }

    const cityRows = await db.all('SELECT city, COUNT(*) as count FROM galleries GROUP BY city');
    const byCity = {};
    for (const r of cityRows) {
      byCity[r.city] = r.count;
    }

    const { totalSent } = await db.get("SELECT COUNT(*) as totalSent FROM send_log WHERE status = 'sent'");
    const { totalOpened } = await db.get("SELECT COUNT(DISTINCT id) as totalOpened FROM send_log WHERE opened_at IS NOT NULL");
    const openRate = totalSent > 0 ? ((totalOpened / totalSent) * 100).toFixed(1) : 0;
    
    const sentToday = await this.getTodaySendCount();

    return {
      total,
      withEmail,
      withoutEmail: total - withEmail,
      byStatus,
      byCity,
      totalSent,
      totalOpened,
      openRate,
      sentToday
    };
  }

  // ─── CSV Export ────────────────────────────────────────────

  async exportCSV() {
    const db = await getDb();
    const galleries = await db.all('SELECT * FROM galleries');
    
    const headers = ['name', 'city', 'address', 'website', 'emails', 'phone', 'rating', 'categories', 'status', 'notes'];
    const lines = [headers.join(',')];
    
    for (const g of galleries) {
      const parsed = this._parseRow(g);
      const row = headers.map(h => {
        let val = parsed[h];
        if (Array.isArray(val)) val = val.join('; ');
        if (val == null) val = '';
        val = String(val).replace(/"/g, '""');
        return `"${val}"`;
      });
      lines.push(row.join(','));
    }
    return lines.join('\n');
  }

  async importCSV(csvString) {
    const lines = csvString.trim().split('\n');
    if (lines.length < 2) return { added: 0, updated: 0 };

    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const galleries = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this._parseCSVLine(lines[i]);
      const gallery = {};
      headers.forEach((h, idx) => {
        let val = (values[idx] || '').trim();
        if (h === 'emails' || h === 'categories') {
          val = val.split(/[;,]/).map(v => v.trim()).filter(Boolean);
        }
        gallery[h] = val;
      });
      galleries.push(gallery);
    }

    return await this.addMany(galleries);
  }

  _parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }
}

module.exports = new GalleryStore();
