const express = require('express');
const router = express.Router();
const googlePlaces = require('../finder/googlePlaces');
const emailScraper = require('../finder/emailScraper');
const galleryStore = require('../data/galleryStore');

// POST /api/finder/search - Search for galleries via Google Places
router.post('/search', async (req, res) => {
  const { cities, queries } = req.body;
  try {
    const results = await googlePlaces.searchAll({
      cities: cities && cities.length > 0 ? cities : undefined,
      queries: queries && queries.length > 0 ? queries : undefined
    });
    // Save to store
    const saveResult = await galleryStore.addMany(results);
    res.json({
      found: results.length,
      ...saveResult
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/finder/search-city - Search a single city
router.post('/search-city', async (req, res) => {
  const { city } = req.body;
  if (!city) return res.status(400).json({ error: 'City name required' });
  try {
    const results = await googlePlaces.searchSingleCity(city);
    const saveResult = await galleryStore.addMany(results);
    res.json({ city, found: results.length, ...saveResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/finder/scrape-emails - Scrape emails for galleries without emails
router.post('/scrape-emails', async (req, res) => {
  const { galleryIds } = req.body;
  let galleries;

  if (galleryIds && galleryIds.length > 0) {
    const promises = galleryIds.map(id => galleryStore.getById(id));
    const fetched = await Promise.all(promises);
    galleries = fetched.filter(Boolean);
  } else {
    galleries = (await galleryStore.getAll({ hasEmail: false, needsScrape: true }))
      .filter(g => g.website);
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');

  if (galleries.length === 0) {
    res.write(JSON.stringify({ type: 'complete', message: 'No new galleries to scrape', updated: 0 }) + '\n');
    return res.end();
  }

  try {
    let updated = 0;
    let stopped = false;
    
    // Listen for both req and res close/aborted events
    const stopHandler = () => {
      if (!stopped) {
        console.log('[Finder Route] Client disconnected, stopping scraper...');
        stopped = true;
      }
    };
    
    req.on('close', stopHandler);
    res.on('close', stopHandler);
    req.on('aborted', stopHandler);

    const results = await emailScraper.scrapeMany(galleries, async (progress) => {
      if (stopped) return; // Don't process progress if already stopped

      const g = galleries[progress.current - 1];
      if (g && g.id) {
        const updates = { last_scraped_at: new Date().toISOString() };
        if (progress.emails && progress.emails.length > 0 && !progress.skipped) {
          updates.emails = progress.emails;
          updated++;
        } else if (progress.error && (progress.error.includes('403') || progress.error.includes('Forbidden'))) {
          updates.status = 'blocked';
          // Append a note so it's clear why it's blocked
          const oldNotes = g.notes || '';
          const antiBotNote = '⚠️ Anti-bot firewall (403 Forbidden) detected. Email must be added manually.';
          if (!oldNotes.includes('Anti-bot firewall')) {
            updates.notes = oldNotes ? oldNotes + '\n' + antiBotNote : antiBotNote;
          }
        }
        await galleryStore.update(g.id, updates);
      }
      
      if (!stopped && !res.writableEnded) {
        res.write(JSON.stringify({ type: 'progress', ...progress }) + '\n');
      }
    }, () => {
      return stopped;
    });
    
    if (!res.writableEnded) {
      res.write(JSON.stringify({ type: 'complete', processed: results.length, updated, stopped }) + '\n');
      res.end();
    }
  } catch (err) {
    res.write(JSON.stringify({ type: 'error', error: err.message }) + '\n');
    res.end();
  }
});

// POST /api/finder/scrape-single - Scrape email for one gallery
router.post('/scrape-single', async (req, res) => {
  const { galleryId, url } = req.body;

  try {
    let websiteUrl = url;
    if (galleryId) {
      const gallery = await galleryStore.getById(galleryId);
      if (!gallery) return res.status(404).json({ error: 'Gallery not found' });
      websiteUrl = gallery.website;
    }
    if (!websiteUrl) return res.status(400).json({ error: 'No website URL' });

    const emails = await emailScraper.scrapeEmails(websiteUrl);

    if (galleryId && emails.length > 0) {
      await galleryStore.update(galleryId, { emails });
    }

    res.json({ url: websiteUrl, emails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
