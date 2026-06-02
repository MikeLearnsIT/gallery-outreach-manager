/**
 * Default configuration for UK Gallery Outreach Manager
 */
module.exports = {
  // UK cities to search for galleries
  searchCities: [
    'London', 'Manchester', 'Birmingham', 'Edinburgh', 'Glasgow',
    'Bristol', 'Liverpool', 'Leeds', 'Brighton', 'Oxford',
    'Cambridge', 'Cardiff', 'Bath', 'York', 'Norwich',
    'Sheffield', 'Nottingham', 'Newcastle', 'Belfast', 'Dundee',
    'Aberdeen', 'Margate', 'St Ives', 'Canterbury', 'Folkestone'
  ],

  // Search queries for Google Places API
  searchQueries: [
    'art gallery',
    'contemporary art gallery',
    'fine art gallery',
    'artist-run gallery',
    'art exhibition space'
  ],

  // Pages to check for contact email on gallery websites
  contactPaths: [
    '/contact',
    '/contact-us',
    '/about',
    '/about-us',
    '/submissions',
    '/submit',
    '/artists',
    '/information',
    '/info'
  ],

  // Email sending limits
  email: {
    dailyLimit: 50,          // Max emails per day
    intervalMs: 45000,        // 45 seconds between emails
    retryAttempts: 2,
    retryDelayMs: 60000       // 1 minute retry delay
  },

  // Web scraping settings
  scraping: {
    requestDelayMs: 2500,     // 2.5 seconds between requests
    timeoutMs: 15000,         // 15 second timeout
    maxRetries: 2,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  },

  // Gallery categories for tagging
  categories: [
    'contemporary',
    'modern',
    'traditional',
    'photography',
    'sculpture',
    'installation',
    'digital',
    'mixed-media',
    'printmaking',
    'craft',
    'design',
    'artist-run',
    'commercial',
    'non-profit',
    'museum'
  ]
};
