# 🎨 Gallery Outreach Manager

A lightweight, self-hosted web tool for artists to **discover UK art galleries**, **scrape contact emails**, and **send personalised outreach emails** — all from a clean browser-based interface.

Built with Node.js + Express + vanilla JS. No database server needed (uses SQLite). Runs entirely on your own machine.

---

## Features

- 🔍 **Gallery Discovery** — Search UK galleries via Google Places API across 25+ cities
- 📧 **Email Scraper** — Automatically finds contact emails from gallery websites (handles obfuscation, Cloudflare protection, mailto links)
- ✉️ **Outreach Sender** — Send personalised emails using your own Gmail / SMTP with built-in daily rate limiting
- 📋 **CRM Dashboard** — Track gallery status (contacted, replied, not interested, blocked, etc.)
- ↩️ **Reply Management** — Manually record gallery replies, classify outcomes, and create follow-up reminders
- 📝 **Email Templates** — Customisable HTML templates with variable substitution (`{{gallery_name}}`, `{{your_name}}`, etc.)
- 📊 **Send Tracking** — Records every email sent with timestamps, delivery status, message IDs, reply tokens, and open tracking
- 🛡️ **Anti-spam controls** — 45-second intervals between sends, 50 emails/day cap, retry logic

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express |
| Frontend | Vanilla HTML / CSS / JS (single-page app) |
| Database | SQLite (via `sqlite` + `sqlite3`) |
| Email | Nodemailer (SMTP) |
| Scraping | Axios + Cheerio |
| Gallery Search | Google Places API |

---

## Getting Started

### Prerequisites

- Node.js **v18+**
- A **Google Places API key** (for gallery discovery)
- A **Gmail account** with an [App Password](https://myaccount.google.com/apppasswords) (for sending emails)

### Installation

```bash
git clone https://github.com/MikeLearnsIT/gallery-outreach-manager.git
cd gallery-outreach-manager
npm install
```

### Configuration

Copy the example environment file and fill in your details:

```bash
cp .env.example .env
```

Then edit `.env`:

```env
# Google Places API
GOOGLE_PLACES_API_KEY=your_google_places_api_key_here

# SMTP Email Configuration
# For Gmail: enable 2FA and create an App Password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password_here

# Your Artist Info (used in email templates)
ARTIST_NAME=Your Name
ARTIST_EMAIL=your_email@gmail.com
ARTIST_WEBSITE=https://your-website.com
PORTFOLIO_URL=https://your-portfolio.com
ARTIST_MEDIUM=contemporary painting

# Optional: reply tracking address
# Defaults to SMTP_USER. Gmail uses plus addressing, e.g. your_email+gom_xxx@gmail.com
REPLY_TO_EMAIL=your_email@gmail.com
# Set true for custom domains that also support plus addressing
REPLY_PLUS_ADDRESSING=false

# Server
PORT=3000
```

> ⚠️ **Never commit your `.env` file.** It is already listed in `.gitignore`.

### Run

```bash
# Development (auto-restarts on file changes)
npm run dev

# Production
npm start
```

Open your browser at **http://localhost:3000**

---

## How It Works

### 1. Find Galleries
Use the **Finder** tab to search Google Places for art galleries across UK cities. Results are saved to the local SQLite database.

### 2. Scrape Emails
The scraper visits each gallery's website and intelligently extracts contact email addresses. It handles:
- Standard `mailto:` links
- Cloudflare email obfuscation (the `cdn-cgi/l/email-protection` scheme)
- Plain-text emails in page content
- Common contact page paths (`/contact`, `/about`, `/submissions`, etc.)

### 3. Send Outreach
Select galleries with emails and send personalised outreach using the built-in email templates. The sender respects rate limits to avoid spam flags.

### 4. Track Responses
Use the **Replies** tab to record gallery responses, classify the outcome, and schedule follow-up reminders. When a reply is added, the app links it to the gallery and automatically matches the latest sent email for that gallery when possible.

Sent emails now store the SMTP `messageId` and a generated `replyToken`. For Gmail addresses, the token is also used in the outbound `Reply-To` address via plus addressing, which prepares the app for future automatic inbox syncing. Custom domains can opt in with `REPLY_PLUS_ADDRESSING=true`.

---

## Email Templates

Templates live in the `templates/` directory as HTML files. Supported variables:

| Variable | Description |
|---|---|
| `{{gallery_name}}` | Gallery name |
| `{{your_name}}` | Your artist name (from `.env`) |
| `{{your_email}}` | Your email address (from `.env`) |
| `{{website_url}}` | Your website URL (from `.env`) |
| `{{medium}}` | Your art medium (from `.env`) |

The email subject line is set in a comment on the first line of the template:

```html
<!-- subject: Gallery enquiry – {{your_name}}, {{medium}} artist -->
```

---

## Project Structure

```
gallery-outreach-manager/
├── config/
│   └── default.js          # Search cities, contact paths, rate limits
├── src/
│   ├── index.js             # Express server entry point
│   ├── data/                # SQLite DB layer (galleryStore)
│   ├── email/               # Nodemailer sender + template engine
│   ├── finder/              # Google Places search + email scraper
│   └── routes/              # REST API routes
│       ├── config.js
│       ├── emails.js
│       ├── finder.js
│       ├── galleries.js
│       └── tracking.js
├── public/                  # Frontend (SPA — HTML/CSS/JS)
├── templates/               # Email HTML templates
├── .env.example             # Environment variable template
└── package.json
```

---

## API Overview

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/galleries` | List all galleries |
| `POST` | `/api/finder/search` | Search Google Places for galleries |
| `POST` | `/api/finder/scrape-emails` | Scrape emails for galleries (streaming) |
| `POST` | `/api/finder/scrape-single` | Scrape email for one gallery |
| `POST` | `/api/emails/send` | Send outreach email |
| `GET` | `/api/replies` | List recorded gallery replies |
| `POST` | `/api/replies` | Add a manually recorded gallery reply |
| `GET` | `/api/replies/followups` | List follow-up reminders |
| `POST` | `/api/replies/followups` | Create a follow-up reminder |
| `GET` | `/api/config` | Get artist config from env |
| `GET` | `/api/health` | Health check |

---

## Customisation

### Cities & Search Queries
Edit `config/default.js` to change which UK cities are searched and what queries are used (e.g. `"artist-run gallery"`, `"contemporary art space"`).

### Rate Limits
Also in `config/default.js`:
```js
email: {
  dailyLimit: 50,       // max emails per day
  intervalMs: 45000,    // 45 seconds between sends
}
```

### Adding Email Templates
Drop any `.html` file into the `templates/` folder. The app will pick it up automatically. Use the `<!-- subject: ... -->` comment on line 1 to set the subject.

---

## Data & Privacy

- All gallery data is stored **locally** in a SQLite file at `data/galleries.db`
- No data is sent to any external server except Google Places (for discovery) and your SMTP provider (for sending)
- The `data/` directory is excluded from git via `.gitignore`

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

---

## License

[MIT](https://choosealicense.com/licenses/mit/)
