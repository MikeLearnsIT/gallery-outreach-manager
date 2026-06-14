const express = require('express');
const router = express.Router();
const galleryStore = require('../data/galleryStore');

// GET /api/galleries - List all galleries with filters
router.get('/', async (req, res) => {
  try {
    const filters = {
      city: req.query.city,
      status: req.query.status,
      hasEmail: req.query.hasEmail === 'true' ? true : req.query.hasEmail === 'false' ? false : undefined,
      category: req.query.category,
      search: req.query.search,
      sortBy: req.query.sortBy,
      sortDir: req.query.sortDir
    };
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const requestedLimit = parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 200)
      : 50;
    const offset = (page - 1) * limit;

    const [total, galleries] = await Promise.all([
      galleryStore.count(filters),
      galleryStore.getAll({ ...filters, limit, offset })
    ]);

    const totalPages = Math.ceil(total / limit);
    
    res.json({ total, page, totalPages, limit, galleries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/galleries/stats - Summary statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await galleryStore.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/galleries/export - Export as CSV
router.get('/export', async (req, res) => {
  try {
    const csv = await galleryStore.exportCSV();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=galleries.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/galleries/:id
router.get('/:id', async (req, res) => {
  try {
    const gallery = await galleryStore.getById(req.params.id);
    if (!gallery) return res.status(404).json({ error: 'Gallery not found' });
    res.json(gallery);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/galleries - Add a gallery manually
router.post('/', async (req, res) => {
  try {
    const result = await galleryStore.addGallery(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/galleries/import - Import CSV
router.post('/import', async (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv) return res.status(400).json({ error: 'CSV data required' });
    const result = await galleryStore.importCSV(csv);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/galleries/:id - Update a gallery
router.put('/:id', async (req, res) => {
  try {
    const gallery = await galleryStore.update(req.params.id, req.body);
    if (!gallery) return res.status(404).json({ error: 'Gallery not found' });
    res.json(gallery);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/galleries/:id
router.delete('/:id', async (req, res) => {
  try {
    const ok = await galleryStore.delete(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Gallery not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
