// Keep this directly executable now that the shared helper is TypeScript.
require('ts-node/register/transpile-only');
const m2mHelper = require('./src/common/m2m-helper');

/**
 * Prints an M2M token from the provider USE_KEYCLOAK selects: the KEYCLOAK_* settings when
 * it is true, otherwise the service's AUTH0_* settings.
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
