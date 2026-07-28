// Keep this directly executable now that the shared helper is TypeScript.
require('ts-node/register/transpile-only');
const m2mHelper = require('./src/common/m2m-helper');

/**
 * Prints an M2M token obtained with the service's existing Auth0 settings.
 *
 * @returns {Promise<void>} a promise that settles after printing the token or
 * reporting the configuration/request error
 */
async function getToken() {
  try {
    const token = await m2mHelper.getM2MToken();
    console.log(token);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

getToken();
