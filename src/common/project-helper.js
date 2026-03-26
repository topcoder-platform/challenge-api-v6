const _ = require("lodash");

const axios = require("axios");
const config = require("config");
const HttpStatus = require("http-status-codes");
const m2mHelper = require("./m2m-helper");
const { hasAdminRole } = require("./role-helper");
const errors = require("./errors");
const logger = require("./logger");

/**
 * Normalizes billing-account markup to the decimal format persisted on
 * challenges.
 *
 * Legacy project-service responses can return whole percentage points (for
 * example `50` for 50%), while newer billing-account records use decimal
 * fractions (for example `0.58` for 58%). This helper preserves modern values
 * and converts only legacy percentages.
 *
 * @param {unknown} rawMarkup Markup value returned by Projects API.
 * @returns {number|null} Decimal markup or `null` when the input is empty or invalid.
 */
function normalizeBillingMarkup(rawMarkup) {
  if (_.isNil(rawMarkup) || rawMarkup === "") {
    return null;
  }

  const markup = _.toNumber(rawMarkup);
  if (!Number.isFinite(markup)) {
    return null;
  }

  return markup > 1 ? markup / 100 : markup;
}

class ProjectHelper {
  /**
   * Get Project Details.
   * Requests project members explicitly so caller membership can be validated.
   * @param {String} projectId the project id
   * @param {String} currentUser the user
   *
   * @returns {Promise<object>} the project details
   */
  async getProject(projectId, currentUser) {
    let token = await m2mHelper.getM2MToken();
    const url = `${config.PROJECTS_API_URL}/${projectId}`;
    logger.debug(`projectHelper.getProject: GET ${url}`);
    try {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        // projects-api-v6 omits members unless explicitly requested.
        params: { fields: "members" },
      });
      logger.debug(
        `projectHelper.getProject: response status ${res.status} for project ${projectId}`
      );
      if (currentUser.isMachine || hasAdminRole(currentUser)) {
        return res.data;
      }
      if (
        _.get(res, "data.type") === "self-service" &&
        _.includes(config.SELF_SERVICE_WHITELIST_HANDLES, currentUser.handle.toLowerCase())
      ) {
        return res.data;
      }
      if (
        !_.find(
          _.get(res, "data.members", []),
          (m) => _.toString(m.userId) === _.toString(currentUser.userId)
        )
      ) {
        throw new errors.ForbiddenError(`You don't have access to project with ID: ${projectId}`);
      }
      return res.data;
    } catch (err) {
      logger.debug(
        `projectHelper.getProject: error for project ${projectId} - status ${
          _.get(err, "response.status", "n/a")
        }: ${err.message}`
      );
      if (_.get(err, "response.status") === HttpStatus.NOT_FOUND) {
        throw new errors.BadRequestError(`Project with id: ${projectId} doesn't exist`);
      } else {
        // re-throw other error
        throw err;
      }
    }
  }

  /**
   * This functions gets the default billing account for a given project id
   *
   * @param {Number} projectId The id of the project for which to get the default terms of use
   * @returns {Promise<Number>} The billing account ID
   */
  async getProjectBillingInformation(projectId) {
    const token = await m2mHelper.getM2MToken();
    const projectUrl = `${config.PROJECTS_API_URL}/${projectId}/billingAccount`;
    logger.debug(`projectHelper.getProjectBillingInformation: GET ${projectUrl}`);
    try {
      const res = await axios.get(projectUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      logger.debug(
        `projectHelper.getProjectBillingInformation: response status ${res.status} for project ${projectId}`
      );

      return {
        billingAccountId: _.get(res, "data.tcBillingAccountId", null),
        markup: normalizeBillingMarkup(_.get(res, "data.markup", null)),
      };
    } catch (err) {
      const responseCode = _.get(err, "response.status");

      if (responseCode === HttpStatus.NOT_FOUND) {
        return {
          billingAccountId: null,
          markup: null,
        };
      } else {
        logger.debug(
          `projectHelper.getProjectBillingInformation: error for project ${projectId} - status ${
            responseCode || "n/a"
          }: ${err.message}`
        );
        throw err;
      }
    }
  }
}

module.exports = new ProjectHelper();
