/**
 * @title Office Hours Service
 * @description Handles logic related to tenant office hours, timezones, and auto-replies.
 */
const { zonedTimeToUtc, utcToZonedTime, format } = require('date-fns-tz');

/**
 * Checks if the current time is within the tenant's defined office hours.
 * @param {object} tenant The tenant object, which must include office_hours_start, office_hours_end, and office_hours_timezone.
 * @returns {boolean} True if within office hours, false otherwise.
 */
const isWithinOfficeHours = (tenant) => {
    const { office_hours_start, office_hours_end, office_hours_timezone } = tenant;

    // If any of the required settings are missing, we assume they are always open.
    if (!office_hours_start || !office_hours_end || !office_hours_timezone) {
        return true;
    }

    try {
        const now = new Date();
        // Get the current date and time in the tenant's specific timezone.
        const zonedNow = utcToZonedTime(now, office_hours_timezone);

        // Get the current time as a simple HH:mm string.
        const currentTimeString = format(zonedNow, 'HH:mm');

        // The office hours are already stored as 'HH:mm' strings in the database.
        return currentTimeString >= office_hours_start && currentTimeString <= office_hours_end;

    } catch (error) {
        console.error(`Error checking office hours. Invalid timezone likely: ${office_hours_timezone}`, error);
        // Default to being open if there's a configuration error to avoid blocking customers.
        return true;
    }
};

module.exports = {
    isWithinOfficeHours,
};

