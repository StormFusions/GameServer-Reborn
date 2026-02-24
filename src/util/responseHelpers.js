/**
 * Response Helper Functions - Standardize common response patterns
 * Reduces code duplication and ensures consistent error formatting
 */

/**
 * Create standardized XML error response
 * @param {number} code - HTTP error code
 * @param {string} type - Error type (e.g., 'MISSING_VALUE', 'NOT_FOUND')
 * @param {string} field - Field related to the error
 * @returns {string} XML error response string
 */
export function createErrorXml(code, type, field) {
  return `<?xml version="1.0" encoding="UTF-8"?><error code="${code}" type="${type}" field="${field}"/>`;
}

/**
 * Send error response with XML format and proper headers
 * @param {object} res - Express response object
 * @param {number} statusCode - HTTP status code to send
 * @param {number} code - Error code for XML
 * @param {string} type - Error type
 * @param {string} field - Field related to error
 */
export function sendErrorXml(res, statusCode, code, type, field) {
  res.type("application/xml").status(statusCode).send(createErrorXml(code, type, field));
}

/**
 * Common error XML responses - pre-built for quick access
 */
export const ErrorResponses = {
  missingToken: () => createErrorXml(400, 'MISSING_VALUE', 'nucleus_token'),
  missingValue: (field) => createErrorXml(400, 'MISSING_VALUE', field),
  invalidToken: (field = 'nucleus_token') => createErrorXml(400, 'BAD_REQUEST', `Invalid AccessToken for specified ${field}`),
  notFound: (field = 'resource') => createErrorXml(404, 'NOT_FOUND', field),
  internalError: () => createErrorXml(500, 'INTERNAL_SERVER_ERROR', 'An internal error occurred'),
};

/**
 * Quick send error based on type
 * @param {object} res - Express response object
 * @param {string} errorType - Type of error (MISSING_TOKEN, INVALID_TOKEN, NOT_FOUND, ERROR)
 * @param {string} field - Optional field name for error context
 */
export function sendError(res, errorType, field = '') {
  const errorMap = {
    'MISSING_TOKEN': () => sendErrorXml(res, 400, 400, 'MISSING_VALUE', 'nucleus_token'),
    'INVALID_TOKEN': () => sendErrorXml(res, 400, 400, 'BAD_REQUEST', field || 'nucleus_token'),
    'NOT_FOUND': () => sendErrorXml(res, 404, 404, 'NOT_FOUND', field || 'resource'),
    'ERROR': () => sendErrorXml(res, 500, 500, 'INTERNAL_SERVER_ERROR', 'Unknown error'),
  };
  
  const handler = errorMap[errorType] || errorMap['ERROR'];
  handler();
}
