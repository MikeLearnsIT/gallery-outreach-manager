const axios = require('axios');
const defaultConfig = require('../../config/default');
const { getConfigValue } = require('../routes/config');

/**
 * Google Places API (New) - Text Search for UK Art Galleries
 *
 * Uses the Places API (New) Text Search endpoint.
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */
class GooglePlacesFinder {
  constructor() {
    this.apiKey = process.env.GOOGLE_PLACES_API_KEY;
    this.baseUrl = 'https://places.googleapis.com/v1/places:searchText';
  }

  /**
   * Search for galleries in a specific city with a specific query
   * @param {string} query - e.g. "art gallery"
   * @param {string} city - e.g. "London"
   * @returns {Promise<Array>} - Array of gallery objects
   */
  async searchCity(query, city) {
    if (!this.apiKey) {
      throw new Error('GOOGLE_PLACES_API_KEY not set in .env file');
    }

    const fullQuery = `${query} in ${city}, UK`;
    console.log(`[GooglePlaces] Requesting API for: "${fullQuery}"...`);
    const results = [];

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          textQuery: fullQuery,
          languageCode: 'en',
          maxResultCount: 20
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': [
              'places.id',
              'places.displayName',
              'places.formattedAddress',
              'places.websiteUri',
              'places.nationalPhoneNumber',
              'places.internationalPhoneNumber',
              'places.rating',
              'places.googleMapsUri',
              'places.businessStatus',
              'places.types'
            ].join(',')
          }
        }
      );

      const places = response.data.places || [];

      for (const place of places) {
        // Only include operational businesses
        if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') continue;

        results.push({
          name: place.displayName?.text || '',
          city: city,
          address: place.formattedAddress || '',
          website: place.websiteUri || '',
          phone: place.internationalPhoneNumber || place.nationalPhoneNumber || '',
          rating: place.rating || null,
          place_id: place.id || '',
          google_maps_url: place.googleMapsUri || '',
          categories: this._mapTypes(place.types || [])
        });
      }
    } catch (err) {
      if (err.response) {
        console.error(`[GooglePlaces] API error for "${fullQuery}":`, err.response.status, err.response.data?.error?.message || '');
      } else {
        console.error(`[GooglePlaces] Network error for "${fullQuery}":`, err.message);
      }
    }

    return results;
  }

  /**
   * Search across all configured cities and queries
   * @param {object} options
   * @param {string[]} options.cities - Override city list
   * @param {string[]} options.queries - Override query list
   * @param {function} options.onProgress - Progress callback (city, query, count)
   * @returns {Promise<Array>} - All found galleries
   */
  async searchAll(options = {}) {
    const cities = options.cities || await getConfigValue('searchCities', defaultConfig.searchCities);
    const queries = options.queries || await getConfigValue('searchQueries', defaultConfig.searchQueries);
    const onProgress = options.onProgress || (() => {});

    const allResults = [];
    const seenPlaceIds = new Set();
    let totalSearches = cities.length * queries.length;
    let completedSearches = 0;

    for (const city of cities) {
      for (const query of queries) {
        try {
          const results = await this.searchCity(query, city);

          // Deduplicate by place_id
          for (const result of results) {
            if (result.place_id && seenPlaceIds.has(result.place_id)) continue;
            if (result.place_id) seenPlaceIds.add(result.place_id);
            allResults.push(result);
          }

          completedSearches++;
          console.log(`[GooglePlaces] Progress: ${completedSearches}/${totalSearches} | Found ${results.length} for "${query}" in ${city}`);
          onProgress({
            city,
            query,
            found: results.length,
            totalUnique: allResults.length,
            progress: Math.round((completedSearches / totalSearches) * 100)
          });

          // Rate limiting between API calls
          await this._delay(1000);
        } catch (err) {
          console.error(`[GooglePlaces] Failed search: "${query}" in ${city}:`, err.message);
          completedSearches++;
        }
      }
    }

    console.log(`[GooglePlaces] Search complete: ${allResults.length} unique galleries found across ${cities.length} cities`);
    return allResults;
  }

  /**
   * Search a single city with all queries
   */
  async searchSingleCity(city) {
    const queries = await getConfigValue('searchQueries', defaultConfig.searchQueries);
    const results = [];
    const seenPlaceIds = new Set();

    for (const query of queries) {
      console.log(`[GooglePlaces] Single city search progress: "${query}" in ${city}...`);
      const found = await this.searchCity(query, city);
      for (const item of found) {
        if (item.place_id && seenPlaceIds.has(item.place_id)) continue;
        if (item.place_id) seenPlaceIds.add(item.place_id);
        results.push(item);
      }
      await this._delay(500);
    }

    return results;
  }

  /**
   * Map Google place types to our categories
   */
  _mapTypes(types) {
    const mapping = {
      'art_gallery': 'contemporary',
      'museum': 'museum',
      'art_studio': 'artist-run'
    };

    const categories = [];
    for (const type of types) {
      if (mapping[type]) categories.push(mapping[type]);
    }
    return categories;
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new GooglePlacesFinder();
