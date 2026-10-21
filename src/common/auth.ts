const { auth } = require('tc-core-library-js')
const config = require('config')
const { UnauthorizedError } = require('./errors')
const validator = auth.createValidator({AUTH_SECRET:config.AUTH_SECRET,VALID_ISSUERS:config.VALID_ISSUERS})

/**
 * Validates a request with the shared core and attaches its normalized principal.
 * @param req Express request with a bearer header. @param res Unused Express response.
 * @param next Express continuation receiving a sanitized 401 on invalid credentials.
 * @returns Promise resolving after validation/continuation; member IDs are adapted to strings.
 * @throws Configuration errors occur at module initialization; token failures pass to next.
 */
async function authenticate (req, res, next) {
  try {
    const header = req.headers.authorization
    const match = typeof header === 'string' ? /^Bearer ([^\s]+)$/i.exec(header) : null
    if (!match) throw new Error('Missing bearer token')
    const principal = await validator.verify(match[1])
    req.authUser = {...principal, userId: principal.userId === undefined ? undefined : String(principal.userId)}
  } catch {
    delete req.authUser
    next(new UnauthorizedError('Invalid or expired token'))
    return
  }
  next()
}

/**
 * Checks explicit route permission alternatives against a shared service principal.
 * @param def Route metadata. @param principal Verified request identity.
 * @returns True for an exact required service scope; missing metadata and member scopes deny.
 * @throws Does not throw for missing route metadata.
 */
function hasRequiredScopes (def, principal) {
  return Array.isArray(def.scopes) && def.scopes.length > 0 && auth.hasScopes(principal, def.scopes, 'any')
}

module.exports = {authenticate, hasRequiredScopes}
