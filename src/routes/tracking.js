const express = require('express');
const router = express.Router();
const galleryStore = require('../data/galleryStore');

// 1x1 transparent GIF buffer
const PIXEL_BIN = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

/**
 * GET /api/track/open/:logId
 * Tracking pixel route
 */
router.get('/open/:logId', async (req, res) => {
  const { logId } = req.params;
  
  try {
    // Log the open event in background
    galleryStore.markAsOpened(logId).catch(err => {
      console.error(`[Tracking] Error marking open for ${logId}:`, err);
    });
  } catch (err) {
    // Ignore errors for the pixel response
  }

  // Always return the pixel
  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': PIXEL_BIN.length,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.send(PIXEL_BIN);
});

module.exports = router;
