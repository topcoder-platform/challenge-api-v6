/**
 * Configure all routes for express app
 */

const _ = require("lodash");
const config = require("config");
const HttpStatus = require("http-status-codes");
const { v4: uuid } = require('uuid');
const util = require("util");
const helper = require("./src/common/helper");
const errors = require("./src/common/errors");
const logger = require("./src/common/logger");
const routes = require("./src/routes");
const { authenticate, hasRequiredScopes } = require("./src/common/auth");

/**
 * Reads normalized service scopes for route diagnostics. Takes the verified principal;
 * returns its scope array, or an empty array for other identities; does not throw.
 */
function getAuthUserScopes(authUser) {
  return isM2MAuthUser(authUser) ? authUser.scopes : [];
}

/**
 * Checks the identity produced by shared validation, without inferring from raw claims.
 * @param authUser Verified principal. @returns True for a service. Does not throw.
 */
function isM2MAuthUser(authUser) {
  return authUser?.kind === "service" && authUser.isMachine === true;
}

/**
 * Checks explicit route scope alternatives without mutating the principal.
 * @param def Route metadata. @param authUser Verified principal.
 * @returns True for an exact approved service scope. Missing scope metadata denies; no throws.
 */
function hasRequiredM2MScopes(def, authUser) {
  return hasRequiredScopes(def, authUser);
}

/** Redacts credential fields from a diagnostic value; returns safe JSON data or an error marker; never throws. */
const sanitizeForLog = (value) => {
  const seen = new WeakSet();
  try {
    return JSON.parse(
      JSON.stringify(value, (key, val) => {
        if (/token|authorization|secret|password/i.test(key)) return "<redacted>";
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "<circular>";
          seen.add(val);
        }
        if (Buffer.isBuffer(val)) return `<Buffer length=${val.length}>`;
        if (val && typeof val === "object" && val.type === "Buffer" && Array.isArray(val.data)) {
          return `<Buffer length=${val.data.length}>`;
        }
        if (Array.isArray(val) && val.length > 30) return `Array(${val.length})`;
        if (typeof val === "string" && val.length > 500) return `${val.slice(0, 500)}...<truncated>`;
        return val;
      })
    );
  } catch (err) {
    return `<unserializable: ${err.message}>`;
  }
};

const safeInspect = (payload) => util.inspect(sanitizeForLog(payload), { breakLength: Infinity });
const getSignature = (req) => req.signature || req._reqLogId || "no-signature";

/**
 * Configure all routes for express app
 * @param app the express app
 */
function configureRoutes(app) {
  // Load all routes
  _.each(routes, (verbs, path) => {
    _.each(verbs, (def, verb) => {
      const controllerPath = `./src/controllers/${def.controller}`;
      const method = require(controllerPath)[def.method];
      if (!method) {
        throw new Error(`${def.method} is undefined`);
      }

      const actions = [];
      actions.push((req, res, next) => {
        if (def.method !== "checkHealth") {
          req._id = uuid();
          req.signature = `${req._id}-${def.controller}#${def.method}`;
          logger.info(
            `Started request handling, ${req.signature} ${req.method} ${req.originalUrl.split("?")[0]} controller=${def.controller}.${def.method} query=${safeInspect(
              req.query
            )} params=${safeInspect(req.params)} body=${safeInspect(req.body)}`
          );
        }
        next();
      });

      actions.push((req, res, next) => {
        if (_.get(req, "query.token")) {
          _.set(req, "headers.authorization", `Bearer ${_.trim(req.query.token)}`);
          logger.info(`[${getSignature(req)}] Promoted query.token to Authorization header`);
        }
        next();
      });

      if (def.auth) {
        // add Authenticator/Authorization check if route has auth
        actions.push((req, res, next) => {
          authenticate(req, res, next);
        });

        actions.push((req, res, next) => {
          if (isM2MAuthUser(req.authUser)) {
            // M2M
            if (!hasRequiredM2MScopes(def, req.authUser)) {
              logger.warn(
                `[${getSignature(req)}] Machine token scope mismatch. required=${safeInspect(
                  def.scopes
                )} provided=${safeInspect(getAuthUserScopes(req.authUser))}`
              );
              next(
                new errors.ForbiddenError(`You are not allowed to perform this action, because the scopes are incorrect. \
                                              Required scopes: ${JSON.stringify(def.scopes)} \
                                              Provided scopes: ${JSON.stringify(getAuthUserScopes(req.authUser))}`)
              );
            } else {
              req.userToken = req.headers.authorization.split(" ")[1];
              logger.info(
                `[${getSignature(req)}] Authenticated M2M token scopes=${safeInspect(
                  req.authUser.scopes
                )}`
              );
              next();
            }
          } else {
            req.authUser.userId = String(req.authUser.userId);
            // User roles authorization
            if (req.authUser.roles) {
              if (
                def.access &&
                !helper.checkIfExists(
                  _.map(def.access, (a) => a.toLowerCase()),
                  _.map(req.authUser.roles, (r) => r.toLowerCase())
                )
              ) {
                logger.warn(
                  `[${getSignature(req)}] User role mismatch required=${safeInspect(
                    def.access
                  )} provided=${safeInspect(req.authUser.roles)}`
                );
                next(
                  new errors.ForbiddenError(`You are not allowed to perform this action, because the roles are incorrect. \
                                                Required roles: ${JSON.stringify(def.access)} \
                                                Provided roles: ${JSON.stringify(req.authUser.roles)}`)
                );
              } else {
                // user token is used in create/update challenge to ensure user can create/update challenge under specific project
                req.userToken = req.headers.authorization.split(" ")[1];
                logger.info(
                  `[${getSignature(req)}] Authenticated user=${req.authUser.userId} roles=${safeInspect(
                    req.authUser.roles
                  )}`
                );
                next();
              }
            } else {
              logger.warn(`[${getSignature(req)}] Authenticated user missing roles`);
              next(
                new errors.ForbiddenError(
                  "You are not authorized to perform this action, \
                                             because no roles were provided"
                )
              );
            }
          }
        });
      } else {
        // public API, but still try to authenticate token if provided, but allow missing/invalid token
        actions.push((req, res, next) => {
          if (!req.headers.authorization) return next();
          // Public routes retain anonymous access after invalid credentials; the adapter clears identity.
          authenticate(req, res, () => next());
        });

        actions.push((req, res, next) => {
          if (!req.authUser) {
            logger.info(`[${getSignature(req)}] Public route: no authUser context`);
            next();
          } else if (isM2MAuthUser(req.authUser)) {
            if (!hasRequiredM2MScopes(def, req.authUser)) {
              return next(new errors.ForbiddenError("Insufficient service scopes"));
            } else {
              logger.info(`[${getSignature(req)}] Public route: valid machine token attached`);
            }
            next();
          } else {
            req.authUser.userId = String(req.authUser.userId);
            logger.info(
              `[${getSignature(req)}] Public route: user present userId=${req.authUser.userId}`
            );
            next();
          }
        });
      }

      actions.push(async (req, res, next) => {
        logger.info(`[${getSignature(req)}] Invoking ${def.controller}.${def.method}`);
        try {
          const resultPromise = method(req, res, next);
          if (resultPromise && typeof resultPromise.then === "function") {
            await resultPromise;
          }
          logger.info(
            `[${getSignature(req)}] Completed ${def.controller}.${def.method} headersSent=${res.headersSent} status=${res.statusCode}`
          );
        } catch (err) {
          logger.error(
            `[${getSignature(req)}] ${def.controller}.${def.method} threw error: ${
              err.message || "unknown error"
            }`
          );
          throw err;
        }
      });

      app[verb](`/${config.API_VERSION}${path}`, helper.autoWrapExpress(actions));
    });
  });

  // Check if the route is not found or HTTP method is not supported
  app.use((req, res) => {
    if (routes[req.baseUrl]) {
      logger.warn(`Unsupported method ${req.method} for ${req.originalUrl.split("?")[0]}`);
      res.status(HttpStatus.METHOD_NOT_ALLOWED).json({
        message: "The requested HTTP method is not supported.",
      });
    } else {
      logger.warn(`Route not found for ${req.method} ${req.originalUrl.split("?")[0]}`);
      res.status(HttpStatus.NOT_FOUND).json({
        message: "The requested resource cannot be found.",
      });
    }
  });
}

module.exports = configureRoutes;
module.exports.__testables = {
  getAuthUserScopes,
  hasRequiredM2MScopes,
  sanitizeForLog,
  isM2MAuthUser,
};
