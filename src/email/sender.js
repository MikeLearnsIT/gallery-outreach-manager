const nodemailer = require('nodemailer');
const config = require('../../config/default');
const galleryStore = require('../data/galleryStore');
const templateEngine = require('./templateEngine');

class EmailSender {
  constructor() {
    this._transporter = null;
  }

  _generateReplyToken(galleryId, logId) {
    return `gom-${galleryId}-${logId}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  _getReplyToAddress(replyToken) {
    const baseAddress = process.env.REPLY_TO_EMAIL || process.env.SMTP_USER;
    if (!baseAddress || !baseAddress.includes('@')) return undefined;

    const [localPart, ...domainParts] = baseAddress.split('@');
    const domain = domainParts.join('@');
    if (!localPart || !domain) return baseAddress;

    const usePlusAddressing = process.env.REPLY_PLUS_ADDRESSING === 'true' || domain.toLowerCase() === 'gmail.com';
    if (!usePlusAddressing) return baseAddress;

    return `${localPart}+${replyToken}@${domain}`;
  }

  _getTransporter() {
    if (this._transporter) return this._transporter;
    this._transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    return this._transporter;
  }

  async verifyConnection() {
    try {
      await this._getTransporter().verify();
      return { ok: true, message: 'SMTP connection verified' };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  async sendToGallery(galleryId, templateName, extraVars = {}, attachments = []) {
    const gallery = await galleryStore.getById(galleryId);
    if (!gallery) throw new Error(`Gallery not found: ${galleryId}`);
    if (!gallery.emails || gallery.emails.length === 0) throw new Error(`No email for gallery: ${gallery.name}`);

    // Check daily limit
    const todayCount = await galleryStore.getTodaySendCount();
    if (todayCount >= config.email.dailyLimit) {
      throw new Error(`Daily email limit reached (${config.email.dailyLimit}). Try again tomorrow.`);
    }

    // Send to all found emails for this gallery by joining them with a comma
    const emailTo = gallery.emails.join(', ');
    const vars = { gallery_name: gallery.name, ...extraVars };
    const rendered = templateEngine.render(templateName, vars);

    const logId = galleryStore._generateId();
    const replyToken = this._generateReplyToken(galleryId, logId);
    const replyTo = this._getReplyToAddress(replyToken);
    const baseUrl = process.env.BASE_URL;
    // Only inject tracking pixel when a real public BASE_URL is configured
    // (localhost tracking pixels are a major spam trigger for Outlook/Hotmail)
    const isRealDomain = baseUrl && !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1');
    const trackingPixel = isRealDomain
      ? `<img src="${baseUrl}/api/track/open/${logId}" width="1" height="1" style="display:none;" />`
      : '';

    const mailOpts = {
      from: `"${process.env.ARTIST_NAME || 'Artist'}" <${process.env.SMTP_USER}>`,
      to: emailTo,
      subject: rendered.subject,
      html: rendered.html + trackingPixel,
      text: rendered.text,
      headers: {
        'X-Gallery-Outreach-Log-Id': logId,
        'X-Gallery-Outreach-Reply-Token': replyToken
      }
    };
    if (replyTo) mailOpts.replyTo = replyTo;

    if (attachments.length > 0) {
      mailOpts.attachments = attachments.map(a => ({
        filename: a.filename || require('path').basename(a.path),
        path: a.path
      }));
    }

    try {
      const info = await this._getTransporter().sendMail(mailOpts);
      await galleryStore.logSend(galleryId, emailTo, templateName, 'sent', {
        id: logId,
        messageId: info.messageId,
        replyToken
      });
      
      return { success: true, messageId: info.messageId, replyToken, to: emailTo, gallery: gallery.name, logId };
    } catch (err) {
      await galleryStore.logSend(galleryId, emailTo, templateName, 'failed', {
        id: logId,
        replyToken
      });
      throw err;
    }
  }

  async sendBatch(galleryIds, templateName, extraVars = {}, attachments = []) {
    const results = [];
    for (let i = 0; i < galleryIds.length; i++) {
      const todayCount = await galleryStore.getTodaySendCount();
      if (todayCount >= config.email.dailyLimit) {
        results.push({ galleryId: galleryIds[i], success: false, error: 'Daily limit reached' });
        continue;
      }
      try {
        const result = await this.sendToGallery(galleryIds[i], templateName, extraVars, attachments);
        results.push({ galleryId: galleryIds[i], ...result });
      } catch (err) {
        results.push({ galleryId: galleryIds[i], success: false, error: err.message });
      }
      // Delay between sends
      if (i < galleryIds.length - 1) {
        await new Promise(r => setTimeout(r, config.email.intervalMs));
      }
    }
    return {
      total: galleryIds.length,
      sent: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  }
}

module.exports = new EmailSender();
