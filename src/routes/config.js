const express = require('express');
const router = express.Router();
const { getDb } = require('../data/db');
const defaultConfig = require('../../config/default');

// ── Helpers ───────────────────────────────────────────────

async function getConfigValue(key, fallback) {
  const db = await getDb();
  const row = await db.get('SELECT value FROM config WHERE key = ?', key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

async function setConfigValue(key, value) {
  const db = await getDb();
  await db.run(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value)
  );
}

// ── Cities ────────────────────────────────────────────────

// GET /api/config/cities
router.get('/cities', async (req, res) => {
  try {
    const cities = await getConfigValue('searchCities', defaultConfig.searchCities);
    res.json({ cities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/config/cities
router.put('/cities', async (req, res) => {
  const { cities } = req.body;
  if (!Array.isArray(cities)) {
    return res.status(400).json({ error: 'cities must be an array' });
  }
  const cleaned = cities.map(c => c.trim()).filter(Boolean);
  try {
    await setConfigValue('searchCities', cleaned);
    res.json({ ok: true, cities: cleaned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Queries ───────────────────────────────────────────────

// GET /api/config/queries
router.get('/queries', async (req, res) => {
  try {
    const queries = await getConfigValue('searchQueries', defaultConfig.searchQueries);
    res.json({ queries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/config/queries
router.put('/queries', async (req, res) => {
  const { queries } = req.body;
  if (!Array.isArray(queries)) {
    return res.status(400).json({ error: 'queries must be an array' });
  }
  const cleaned = queries.map(q => q.trim()).filter(Boolean);
  try {
    await setConfigValue('searchQueries', cleaned);
    res.json({ ok: true, queries: cleaned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Export helper for other modules ──────────────────────
// googlePlaces.js uses this to read the live city/query lists
module.exports = router;
module.exports.getConfigValue = getConfigValue;
