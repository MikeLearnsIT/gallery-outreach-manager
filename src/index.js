require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api/galleries', require('./routes/galleries'));
app.use('/api/finder', require('./routes/finder'));
app.use('/api/emails', require('./routes/emails'));
app.use('/api/config', require('./routes/config'));
app.use('/api/track', require('./routes/tracking'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🎨 UK Gallery Outreach Manager running at http://localhost:${PORT}\n`);
});
