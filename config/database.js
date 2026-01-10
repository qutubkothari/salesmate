require('dotenv').config();

// Local SQLite only: reuse the shared query wrapper.
const { dbClient } = require('../services/config');

// Export a pool-like interface for compatibility
module.exports = {
  query: async (text, params) => {
    // Parse SQL to get table name (basic implementation)
    // This is a simplified adapter - you may need to enhance it
    console.log('Query:', text, params);
    throw new Error('Direct SQL queries not supported with dbClient. Use dbClient client instead.');
  },
  dbClient,
};
