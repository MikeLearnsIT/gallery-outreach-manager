const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const config = require('../../config/default');

class EmailScraper {
  constructor() {
    this.settings = config.scraping;
    this.emailRegex = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;
    this.obfuscationPatterns = [
      { pattern: /\s*\[\s*at\s*\]\s*/gi, replacement: '@' },
      { pattern: /\s*\(\s*at\s*\)\s*/gi, replacement: '@' },
      { pattern: /\s*\{\s*at\s*\}\s*/gi, replacement: '@' },
      { pattern: /\s*\[\s*dot\s*\]\s*/gi, replacement: '.' },
      { pattern: /\s*\(\s*dot\s*\)\s*/gi, replacement: '.' },
      { pattern: /\s*\{\s*dot\s*\}\s*/gi, replacement: '.' }
    ];
    this.ignorePatterns = [
      /noreply@/i, /no-reply@/i, /example\.(com|org)/i,
      /wixpress\.com/i, /squarespace\.com/i, /wordpress\.(com|org)/i,
      /sentry\.io/i,
      /\.png$/i, /\.jpg$/i, /\.css$/i, /\.js$/i
    ];
  }

  async scrapeEmails(websiteUrl) {
    if (!websiteUrl) return [];
    console.log(`[EmailScraper] Starting to scrape emails for: ${websiteUrl}`);
    const allEmails = new Set();
    const baseUrl = this._normalizeUrl(websiteUrl);
    // If the input was a specific page (like /about/), we should check it first
    const homepageEmails = await this._scrapePage(websiteUrl.startsWith('http') ? websiteUrl : baseUrl);
    homepageEmails.forEach(e => allEmails.add(e));

    if (allEmails.size > 0) return [...allEmails];

    for (const p of config.contactPaths) {
      try {
        const pageUrl = new URL(p, baseUrl).href;
        const emails = await this._scrapePage(pageUrl);
        emails.forEach(e => allEmails.add(e));
        if (allEmails.size > 0) break;
        await this._delay(this.settings.requestDelayMs);
      } catch (err) { /* skip */ }
    }
    return [...allEmails];
  }

  async _scrapePage(url) {
    console.log(`[EmailScraper] Requesting page: ${url}`);
    const emails = new Set();
    try {
      const res = await axios.get(url, {
        timeout: this.settings.timeoutMs,
        headers: { 
          'User-Agent': this.settings.userAgent, 
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9,en-GB;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'max-age=0',
          'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1'
        },
        maxRedirects: 3, 
        validateStatus: s => s < 400,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      });
      if (typeof res.data !== 'string') return [];
      const $ = cheerio.load(res.data);

      $('a[href^="mailto:"]').each((_, el) => {
        const email = ($(el).attr('href') || '').replace('mailto:', '').split('?')[0].trim().toLowerCase();
        if (this._isValid(email)) emails.add(email);
      });

      // Decode Cloudflare protected emails
      $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const hashIndex = href.indexOf('#');
        if (hashIndex !== -1) {
          const hash = href.substring(hashIndex + 1);
          if (hash.length >= 2) {
            let email = '';
            const key = parseInt(hash.substring(0, 2), 16);
            for (let n = 2; n < hash.length; n += 2) {
              const charCode = parseInt(hash.substring(n, n + 2), 16) ^ key;
              email += String.fromCharCode(charCode);
            }
            email = email.toLowerCase();
            if (this._isValid(email)) emails.add(email);
          }
        }
      });

      // Walk all text nodes individually to avoid cheerio's .text() concatenating
      // adjacent sibling text (e.g. <a>email@foo.com</a>call → "email@foo.comcall").
      // Skip text nodes inside <a href="mailto:..."> — already captured cleanly from href.
      $('*').contents().each((_, el) => {
        if (el.type === 'text') {
          const parent = el.parent;
          if (parent && parent.name === 'a') {
            const href = (parent.attribs && parent.attribs.href) || '';
            if (href.toLowerCase().startsWith('mailto:')) return; // already captured
          }
          const text = $(el).text().trim();
          if (text) this._extractFromText(text).forEach(e => emails.add(e));
        }
      });

      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const json = JSON.parse($(el).html());
          if (json.email) {
            const e = json.email.replace('mailto:', '').toLowerCase();
            if (this._isValid(e)) emails.add(e);
          }
        } catch (e) { /* skip */ }
      });
    } catch (err) {
      console.error(`[EmailScraper] Failed to scrape ${url}: ${err.message}`);
    }
    return [...emails];
  }

  _extractFromText(text) {
    if (!text) return [];
    let cleaned = text;
    for (const { pattern, replacement } of this.obfuscationPatterns) {
      cleaned = cleaned.replace(pattern, replacement);
    }
    const matches = cleaned.match(this.emailRegex) || [];
    this.emailRegex.lastIndex = 0;
    return matches.map(e => e.toLowerCase().trim()).filter(e => this._isValid(e));
  }

  _isValid(email) {
    if (!email || email.length < 5 || email.length > 254) return false;
    this.emailRegex.lastIndex = 0;
    if (!this.emailRegex.test(email)) { this.emailRegex.lastIndex = 0; return false; }
    this.emailRegex.lastIndex = 0;
    for (const p of this.ignorePatterns) { if (p.test(email)) return false; }
    const parts = email.split('.');
    return parts[parts.length - 1].length >= 2;
  }

  async scrapeMany(galleries, onProgress = () => { }, shouldStop = () => false) {
    const results = [];
    for (let i = 0; i < galleries.length; i++) {
      if (shouldStop()) {
        console.log('[EmailScraper] Scraping stopped by user/caller');
        break;
      }
      const g = galleries[i];
      if (!g.website) {
        results.push({ ...g, emails: [] });
        onProgress({ current: i + 1, total: galleries.length, gallery: g.name, emails: [] });
        continue;
      }
      if (g.emails && g.emails.length > 0) {
        results.push(g);
        onProgress({ current: i + 1, total: galleries.length, gallery: g.name, emails: g.emails, skipped: true });
        continue;
      }
      try {
        console.log(`[EmailScraper] Progress: ${i + 1}/${galleries.length} | Scraping gallery: "${g.name}"`);
        const emails = await this.scrapeEmails(g.website);
        results.push({ ...g, emails });
        onProgress({ current: i + 1, total: galleries.length, gallery: g.name, emails });
      } catch (err) {
        results.push({ ...g, emails: [] });
        onProgress({ current: i + 1, total: galleries.length, gallery: g.name, emails: [], error: err.message });
      }
      if (i < galleries.length - 1) {
        if (shouldStop()) break;
        await this._delay(this.settings.requestDelayMs);
      }
    }
    return results;
  }

  _normalizeUrl(url) {
    if (!url.startsWith('http')) url = 'https://' + url;
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}`;
    } catch (e) {
      return url.replace(/\/+$/, '');
    }
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = new EmailScraper();
