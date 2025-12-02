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
const authenticator = require("tc-core-library-js").middleware.jwtAuthenticator;

const sanitizeForLog = (value) => {
  const seen = new WeakSet();
  try {
    return JSON.parse(
      JSON.stringify(value, (key, val) => {
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
module.exports = (app) => {
  // Load all routes
  _.each(routes, (verbs, path) => {
    _.each(verbs, (def, verb) => {
      const controllerPath = `./src/controllers/${def.controller}`;
      const method = require(controllerPath)[def.method]; // eslint-disable-line
      if (!method) {
        throw new Error(`${def.method} is undefined`);
      }

      const actions = [];
      actions.push((req, res, next) => {
        if (def.method !== "checkHealth") {
          req._id = uuid();
          req.signature = `${req._id}-${def.controller}#${def.method}`;
          logger.info(
            `Started request handling, ${req.signature} ${req.method} ${req.originalUrl} controller=${def.controller}.${def.method} query=${safeInspect(
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
          authenticator(_.pick(config, ["AUTH_SECRET", "VALID_ISSUERS"]))(req, res, next);
        });

        actions.push((req, res, next) => {
          if (req.authUser.isMachine) {
            // M2M
            if (!req.authUser.scopes || !helper.checkIfExists(def.scopes, req.authUser.scopes)) {
              logger.warn(
                `[${getSignature(req)}] Machine token scope mismatch. required=${safeInspect(
                  def.scopes
                )} provided=${safeInspect(req.authUser.scopes)}`
              );
              next(new errors.ForbiddenError(`You are not allowed to perform this action, because the scopes are incorrect. \
                                              Required scopes: ${JSON.stringify(def.scopes)} \
                                              Provided scopes: ${JSON.stringify(req.authUser.scopes)}`));
            } else {
              req.authUser.handle = config.M2M_AUDIT_HANDLE;
              req.authUser.userId = config.M2M_AUDIT_USERID;
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
                next(new errors.ForbiddenError(`You are not allowed to perform this action, because the roles are incorrect. \
                                                Required roles: ${JSON.stringify(def.access)} \
                                                Provided roles: ${JSON.stringify(req.authUser.roles)}`));
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
              next(new errors.ForbiddenError("You are not authorized to perform this action, \
                                             because no roles were provided"));
            }
          }
        });
      } else {
        // public API, but still try to authenticate token if provided, but allow missing/invalid token
        actions.push((req, res, next) => {
          const hasToken =
            !!req.headers.authorization || !!_.get(req, "query.token") || !!req.authUser;
          if (!hasToken) {
            return next();
          }
          const interceptRes = {};
          interceptRes.status = () => interceptRes;
          interceptRes.json = () => interceptRes;
          interceptRes.send = (payload) => {
            logger.info(
              `[${getSignature(req)}] Public route: authenticator send called payload=${safeInspect(
                payload
              )}`
            );
            return next();
          };
          const authMw = authenticator(_.pick(config, ["AUTH_SECRET", "VALID_ISSUERS"]));
          let finished = false;
          const bailoutTimer = setTimeout(() => {
            if (finished) return;
            finished = true;
            next();
          }, 8000);
          authMw(req, interceptRes, (...args) => {
            if (finished) return;
            finished = true;
            clearTimeout(bailoutTimer);
            next(...args);
          });
        });

        actions.push((req, res, next) => {
          if (!req.authUser) {
            logger.info(`[${getSignature(req)}] Public route: no authUser context`);
            next();
          } else if (req.authUser.isMachine) {
            if (
              !def.scopes ||
              !req.authUser.scopes ||
              !helper.checkIfExists(def.scopes, req.authUser.scopes)
            ) {
              logger.info(
                `[${getSignature(req)}] Public route: dropping machine token due to scope mismatch`
              );
              req.authUser = undefined;
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
      logger.warn(`Unsupported method ${req.method} for ${req.originalUrl}`);
      res.status(HttpStatus.METHOD_NOT_ALLOWED).json({
        message: "The requested HTTP method is not supported.",
      });
    } else {
      logger.warn(`Route not found for ${req.method} ${req.originalUrl}`);
      res.status(HttpStatus.NOT_FOUND).json({
        message: "The requested resource cannot be found.",
      });
    }
  });
};
