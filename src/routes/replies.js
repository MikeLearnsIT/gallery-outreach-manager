const express = require('express');
const router = express.Router();
const galleryStore = require('../data/galleryStore');

// GET /api/replies - List replies with optional filters
router.get('/', async (req, res) => {
  try {
    const replies = await galleryStore.getReplies({
      galleryId: req.query.galleryId,
      status: req.query.status,
      classification: req.query.classification,
      search: req.query.search
    });
    res.json({ total: replies.length, replies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/replies - Add a manually recorded reply
router.post('/', async (req, res) => {
  try {
    const reply = await galleryStore.addReply(req.body);
    res.json(reply);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/replies/followups - List follow-ups
router.get('/followups', async (req, res) => {
  try {
    const followups = await galleryStore.getFollowups({
      galleryId: req.query.galleryId,
      replyId: req.query.replyId,
      status: req.query.status,
      dueBefore: req.query.dueBefore
    });
    res.json({ total: followups.length, followups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/replies/followups - Add a follow-up
router.post('/followups', async (req, res) => {
  try {
    const followup = await galleryStore.addFollowup(req.body);
    res.json(followup);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/replies/followups/:id - Update a follow-up
router.put('/followups/:id', async (req, res) => {
  try {
    const followup = await galleryStore.updateFollowup(req.params.id, req.body);
    if (!followup) return res.status(404).json({ error: 'Follow-up not found' });
    res.json(followup);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/replies/followups/:id - Delete a follow-up
router.delete('/followups/:id', async (req, res) => {
  try {
    const ok = await galleryStore.deleteFollowup(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Follow-up not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/replies/:id - Get a single reply
router.get('/:id', async (req, res) => {
  try {
    const reply = await galleryStore.getReplyById(req.params.id);
    if (!reply) return res.status(404).json({ error: 'Reply not found' });
    res.json(reply);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/replies/:id - Update a reply
router.put('/:id', async (req, res) => {
  try {
    const reply = await galleryStore.updateReply(req.params.id, req.body);
    if (!reply) return res.status(404).json({ error: 'Reply not found' });
    res.json(reply);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/replies/:id - Delete a reply
router.delete('/:id', async (req, res) => {
  try {
    const ok = await galleryStore.deleteReply(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Reply not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
