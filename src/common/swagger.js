const _ = require("lodash");
const routes = require("../routes");

/**
 * Produce a Swagger document augmented with authorization metadata derived from the route map.
 * @param {Object} baseDoc Base swagger definition loaded from YAML
 * @returns {Object} cloned document with auth annotations per operation
 */
function withAuthMetadata(baseDoc) {
  if (!baseDoc || !baseDoc.paths) {
    return baseDoc;
  }

  const annotatedDoc = _.cloneDeep(baseDoc);
  const normalizedRoutes = {};

  _.forEach(routes, (verbs, path) => {
    normalizedRoutes[path] = {};
    _.forEach(verbs, (definition, verb) => {
      normalizedRoutes[path][verb.toLowerCase()] = definition || {};
    });
  });

  _.forEach(annotatedDoc.paths, (operations, path) => {
    const routeConfig = normalizedRoutes[path];
    if (!routeConfig) {
      return;
    }

    _.forEach(operations, (operation, method) => {
      const definition = routeConfig[method.toLowerCase()];
      if (!definition || !operation) {
        return;
      }

      const roles = _.uniq(definition.access || []);
      const scopes = _.uniq(definition.scopes || []);
      const jwtRequired = Boolean(definition.auth);
      const m2mRequired = scopes.length > 0;
      const jwtLine = roles.length
        ? `${jwtRequired ? "JWT roles" : "Optional JWT roles"}: ${roles.join(", ")}`
        : jwtRequired
        ? "JWT roles: Any authenticated user role"
        : "JWT roles: Not required (public endpoint)";
      const m2mLine = m2mRequired
        ? `${jwtRequired ? "M2M scopes" : "Optional M2M scopes"}: ${scopes.join(", ")}`
        : jwtRequired
        ? "M2M scopes: Not applicable (user JWT only)"
        : "M2M scopes: Not required";
      const authSection = `**Authorization**\n- ${jwtLine}\n- ${m2mLine}`;

      if (operation.description) {
        if (!operation.description.includes("**Authorization**")) {
          operation.description = `${operation.description}\n\n${authSection}`;
        }
      } else {
        operation.description = authSection;
      }

      operation["x-authentication"] = {
        jwt: {
          required: jwtRequired,
          roles,
        },
        m2m: {
          scopes,
          required: m2mRequired,
        },
      };

      if (jwtRequired) {
        operation.security = operation.security || [];
        const hasBearer = operation.security.some((entry) => Object.prototype.hasOwnProperty.call(entry, "bearer"));
        if (!hasBearer && annotatedDoc.securityDefinitions && annotatedDoc.securityDefinitions.bearer) {
          operation.security.push({ bearer: [] });
        }
      }
    });
  });

  annotatedDoc.info = annotatedDoc.info || {};
  annotatedDoc.info["x-notes"] = annotatedDoc.info["x-notes"] || {};
  annotatedDoc.info["x-notes"].authorization =
    "Authorization metadata (roles and scopes) generated from src/routes.js at runtime.";

  return annotatedDoc;
}

module.exports = {
  withAuthMetadata,
};
