const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

class TemplateEngine {
  constructor() {
    this.defaultVars = {
      your_name: process.env.ARTIST_NAME || 'Artist',
      your_email: process.env.ARTIST_EMAIL || '',
      website_url: process.env.ARTIST_WEBSITE || '',
      portfolio_url: process.env.PORTFOLIO_URL || '',
      medium: process.env.ARTIST_MEDIUM || 'visual art'
    };
  }

  getTemplateList() {
    if (!fs.existsSync(TEMPLATES_DIR)) return [];
    return fs.readdirSync(TEMPLATES_DIR)
      .filter(f => f.endsWith('.html'))
      .map(f => {
        const content = fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf-8');
        const subjectMatch = content.match(/<!--\s*subject:\s*(.+?)\s*-->/i);
        return {
          name: f.replace('.html', ''),
          filename: f,
          subject: subjectMatch ? subjectMatch[1] : 'Artist Portfolio Submission',
          preview: content.replace(/<[^>]*>/g, '').slice(0, 200).trim()
        };
      });
  }

  getTemplate(name) {
    const filePath = path.join(TEMPLATES_DIR, `${name}.html`);
    if (!fs.existsSync(filePath)) throw new Error(`Template "${name}" not found`);
    return fs.readFileSync(filePath, 'utf-8');
  }

  saveTemplate(name, content) {
    if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
    fs.writeFileSync(path.join(TEMPLATES_DIR, `${name}.html`), content, 'utf-8');
  }

  render(templateName, variables = {}) {
    const template = this.getTemplate(templateName);
    const vars = { ...this.defaultVars, ...variables };

    // Extract subject line from template comment
    const subjectMatch = template.match(/<!--\s*subject:\s*(.+?)\s*-->/i);
    let subject = subjectMatch ? subjectMatch[1] : 'Artist Portfolio Submission';

    // Replace variables in subject
    subject = this._replaceVars(subject, vars);

    // Replace variables in body
    const html = this._replaceVars(template, vars);

    // Generate plain text fallback
    const text = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<li>/gi, '• ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { subject, html, text };
  }

  preview(templateName, galleryName = 'Example Gallery') {
    return this.render(templateName, { gallery_name: galleryName });
  }

  _replaceVars(str, vars) {
    return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return vars[key] !== undefined ? vars[key] : match;
    });
  }
}

module.exports = new TemplateEngine();
