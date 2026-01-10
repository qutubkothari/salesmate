// Price inquiry handling logic moved from customerHandler.js
const { dbClient, sendAndLogMessage } = require('./imports');

const handlePriceInquiry = async (userQuery, tenant, from, conversation, res) => {
	// ...existing price inquiry guard logic from customerHandler.js...
};

module.exports = {
	handlePriceInquiry
};
// Price inquiry handling

