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
   * @property {Promise|null} pending - In-flight fetch promise (if any)
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

    // Per-URL custom TTLs
    _ttls: {},

    /**
     * Fetch with caching. Returns cached response if valid, else fetches.
     * @param {string} url - API endpoint URL
     * @param {number} ttl - Cache TTL in milliseconds (default: 5000)
     * @returns {Promise<*>} Parsed JSON response
     */
    fetch: function (url, ttl) {
      // Validate URL parameter
      if (!url || typeof url !== 'string') {
        console.error('[V6 ApiCache] Invalid URL:', url);
        return Promise.reject(new Error('Invalid URL'));
      }

      // Use per-URL TTL if set, otherwise use passed ttl or default
      ttl = this._ttls[url] || ttl || this._defaultTtl;
      var cached = this._memory[url];
      var now = Date.now();

      // Try to restore from localStorage if not in memory
      if (!cached && localStorage) {
        try {
          var storedKey = 'v6-cache:' + encodeURIComponent(url);
          var stored = localStorage.getItem(storedKey);
          if (stored) {
            var parsed = JSON.parse(stored);
            if (parsed && parsed.data && parsed.timestamp && parsed.ttl) {
              if ((now - parsed.timestamp) < parsed.ttl) {
                cached = this._memory[url] = {
                  data: parsed.data,
                  timestamp: parsed.timestamp,
                  pending: null
                };
              }
            }
          }
        } catch (e) {
          // Silently skip corrupt entries
        }
      }

      // Return if cache is fresh and not in-flight
      if (cached && !cached.pending && (now - cached.timestamp) < ttl) {
        return Promise.resolve(cached.data);
      }

      // Return pending promise if request is in-flight
      if (cached && cached.pending) {
        return cached.pending;
      }

      // Create the fetch promise FIRST
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
            localStorage.setItem('v6-cache:' + encodeURIComponent(url), serialized);
          } catch (e) {
            if (e.name === 'QuotaExceededError') {
              console.warn('[V6 ApiCache] localStorage quota exceeded for', url);
            }
          }
          return data;
        })
        .catch(function (error) {
          // CRITICAL FIX: Clear entire entry on error, not just pending flag
          delete self._memory[url];
          console.error('[V6 ApiCache] fetch failed for ' + url, error);
          throw error;
        });

      // Mark as pending BEFORE returning
      this._memory[url] = { data: null, timestamp: 0, pending: promise };

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
     * Restore cache from localStorage (call on init)
     */
    _restore: function () {
      var self = this;
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf('v6-cache:') === 0) {
          try {
            var stored = JSON.parse(localStorage.getItem(key));
            if (stored && stored.data && stored.timestamp && stored.ttl) {
              var now = Date.now();
              if ((now - stored.timestamp) < stored.ttl) {
                var url = decodeURIComponent(key.substring(9)); // Remove 'v6-cache:' prefix
                self._memory[url] = {
                  data: stored.data,
                  timestamp: stored.timestamp,
                  pending: null
                };
              }
            }
          } catch (e) {
            // Silently skip corrupt entries
          }
        }
      }
    },

    /**
     * Set custom TTL for a specific URL
     */
    setTtl: function (url, ttl) {
      this._ttls[url] = ttl;
    }
  };
})();
