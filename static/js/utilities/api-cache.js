// ---------- API Request Cache Utility ----------
// Deduplicates in-flight requests and caches responses by URL
// Prevents 6x duplicate calls to hyperliquid/* endpoints

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

  /**
   * @typedef {Object} CacheEntry
   * @property {*} data - Cached response data
   * @property {number} timestamp - When cached (ms since epoch)
   * @property {Promise} pending - In-flight fetch promise (if any)
   */

  /**
   * V6OF.ApiCache - Request deduplication cache
   * - In-memory cache prevents duplicate XHRs in current session
   * - localStorage cache survives page reload
   * - Configurable TTL per request
   */
  V6OF.ApiCache = {
    // In-memory cache: url -> { data, timestamp, pending }
    _memory: {},

    // Default TTL: 5 seconds
    _defaultTtl: 5000,

    /**
     * Fetch with caching. Returns cached response if valid, else fetches.
     * @param {string} url - API endpoint URL
     * @param {number} ttl - Cache TTL in milliseconds (default: 5000)
     * @returns {Promise<*>} Parsed JSON response
     */
    fetch: function (url, ttl) {
      ttl = ttl || this._defaultTtl;
      var cached = this._memory[url];
      var now = Date.now();

      // Return if cache is fresh and not in-flight
      if (cached && !cached.pending && (now - cached.timestamp) < ttl) {
        return Promise.resolve(cached.data);
      }

      // Return pending promise if request is in-flight
      if (cached && cached.pending) {
        return cached.pending;
      }

      // Fetch and cache
      var self = this;
      var promise = window.fetch(url)
        .then(function (response) {
          if (!response.ok) {
            throw new Error('HTTP ' + response.status);
          }
          return response.json();
        })
        .then(function (data) {
          // Store in memory
          self._memory[url] = {
            data: data,
            timestamp: Date.now(),
            pending: null
          };
          // Store in localStorage (persist across reloads)
          try {
            var serialized = JSON.stringify({
              data: data,
              timestamp: Date.now(),
              ttl: ttl
            });
            localStorage.setItem('v6-cache:' + url, serialized);
          } catch (e) {
            // Quota exceeded or disabled—silently skip localStorage
          }
          return data;
        })
        .catch(function (error) {
          // Clear pending flag on error
          if (self._memory[url]) {
            self._memory[url].pending = null;
          }
          console.error('[V6 ApiCache] fetch failed for ' + url, error);
          throw error;
        });

      // Mark as pending
      if (!this._memory[url]) {
        this._memory[url] = { data: null, timestamp: 0, pending: promise };
      } else {
        this._memory[url].pending = promise;
      }

      return promise;
    },

    /**
     * Clear cache for a specific URL (or all if url is null)
     */
    clear: function (url) {
      if (url) {
        delete this._memory[url];
        try {
          localStorage.removeItem('v6-cache:' + url);
        } catch (e) {}
      } else {
        this._memory = {};
        var keys = [];
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (key && key.indexOf('v6-cache:') === 0) {
            keys.push(key);
          }
        }
        keys.forEach(function (key) {
          try {
            localStorage.removeItem(key);
          } catch (e) {}
        });
      }
    },

    /**
     * Set custom TTL for a URL pattern (e.g., /api/hyperliquid/*)
     */
    setTtl: function (url, ttl) {
      this._defaultTtl = ttl;
    }
  };
})();
