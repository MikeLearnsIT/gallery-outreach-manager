const express = require('express');
const router = express.Router();
const templateEngine = require('../email/templateEngine');
const emailSender = require('../email/sender');
const galleryStore = require('../data/galleryStore');

// GET /api/emails/templates - List available templates
router.get('/templates', (req, res) => {
  res.json(templateEngine.getTemplateList());
});

// GET /api/emails/templates/:name - Get template content
router.get('/templates/:name', (req, res) => {
  try {
    const content = templateEngine.getTemplate(req.params.name);
    res.json({ name: req.params.name, content });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// PUT /api/emails/templates/:name - Save/update template
router.put('/templates/:name', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Template content required' });
  templateEngine.saveTemplate(req.params.name, content);
  res.json({ success: true, name: req.params.name });
});

// POST /api/emails/preview - Preview rendered email
router.post('/preview', (req, res) => {
  const { template, gallery_name } = req.body;
  if (!template) return res.status(400).json({ error: 'Template name required' });
  try {
    const rendered = templateEngine.preview(template, gallery_name || 'Example Gallery');
    res.json(rendered);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/emails/send - Send email to a single gallery
router.post('/send', async (req, res) => {
  const { galleryId, template, extraVars } = req.body;
  if (!galleryId || !template) {
    return res.status(400).json({ error: 'galleryId and template required' });
  }
  try {
    const result = await emailSender.sendToGallery(galleryId, template, extraVars || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/emails/send-batch - Send emails to multiple galleries
router.post('/send-batch', async (req, res) => {
  const { galleryIds, template, extraVars } = req.body;
  if (!galleryIds || !template) {
    return res.status(400).json({ error: 'galleryIds array and template required' });
  }
  try {
    const result = await emailSender.sendBatch(galleryIds, template, extraVars || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/emails/verify - Verify SMTP connection
router.post('/verify', async (req, res) => {
  const result = await emailSender.verifyConnection();
  res.json(result);
});

// GET /api/emails/log - Get send log
router.get('/log', async (req, res) => {
  try {
    const log = await galleryStore.getSendLog({
      galleryId: req.query.galleryId,
      status: req.query.status
    });
    res.json({ total: log.length, log });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
