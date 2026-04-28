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

/**
 * Normalizes optional billing-account string values returned by upstream APIs.
 *
 * @param {unknown} rawValue String-like value from Projects API or Billing Accounts API.
 * @returns {string|null} Trimmed string or `null` when the value is empty.
 */
function normalizeOptionalString(rawValue) {
  if (_.isNil(rawValue)) {
    return null;
  }

  const normalizedValue = _.toString(rawValue).trim();

  return normalizedValue || null;
}

/**
 * Normalizes optional billing-account boolean values returned by upstream APIs.
 *
 * @param {unknown} rawValue Boolean-like value from Projects API or Billing Accounts API.
 * @returns {boolean|null} Parsed boolean or `null` when the value cannot be resolved.
 */
function normalizeOptionalBoolean(rawValue) {
  if (_.isBoolean(rawValue)) {
    return rawValue;
  }

  if (_.isString(rawValue)) {
    const normalizedValue = rawValue.trim().toLowerCase();

    if (normalizedValue === "true") {
      return true;
    }

    if (normalizedValue === "false") {
      return false;
    }
  }

  return null;
}

/**
 * Normalizes optional billing-account numeric values returned by upstream APIs.
 *
 * @param {unknown} rawValue Number-like value from Billing Accounts API.
 * @returns {number|null} Parsed finite number or `null` when the value is empty.
 */
function normalizeOptionalNumber(rawValue) {
  if (_.isNil(rawValue) || rawValue === "") {
    return null;
  }

  const normalizedValue = _.toNumber(rawValue);

  return Number.isFinite(normalizedValue) ? normalizedValue : null;
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
   * Gets the default billing-account metadata for a project.
   *
   * Returns the linked billing-account id and markup for challenge persistence,
   * along with activity/expiry metadata used to validate challenge launches.
   *
   * @param {Number} projectId Project identifier whose default billing account should be fetched.
   * @returns {Promise<object>} Normalized billing-account fields resolved from Projects API.
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
      const active = normalizeOptionalBoolean(_.get(res, "data.active", null));
      const endDate = normalizeOptionalString(_.get(res, "data.endDate", null));

      return {
        billingAccountId: _.get(res, "data.tcBillingAccountId", null),
        markup: normalizeBillingMarkup(_.get(res, "data.markup", null)),
        ...(active !== null ? { active } : {}),
        ...(endDate ? { endDate } : {}),
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

  /**
   * Gets detailed billing-account metadata needed for launch validation.
   *
   * The Billing Accounts API is the source of truth for lifecycle status and
   * remaining budget. Challenge launch validation uses this method to block
   * launches for inactive, expired, or depleted billing accounts.
   *
   * @param {string|number} billingAccountId Billing-account identifier to fetch.
   * @returns {Promise<object|null>} Normalized billing-account details, or `null` when not found.
   */
  async getBillingAccountDetails(billingAccountId) {
    const normalizedBillingAccountId = normalizeOptionalString(billingAccountId);

    if (!normalizedBillingAccountId) {
      return null;
    }

    const token = await m2mHelper.getM2MToken();
    const url = `${config.BILLING_ACCOUNTS_API_URL}/${encodeURIComponent(normalizedBillingAccountId)}`;
    logger.debug(`projectHelper.getBillingAccountDetails: GET ${url}`);

    try {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      logger.debug(
        `projectHelper.getBillingAccountDetails: response status ${res.status} for billingAccountId ${normalizedBillingAccountId}`
      );

      return {
        active: normalizeOptionalBoolean(_.get(res, "data.active", null)),
        billingAccountId:
          normalizeOptionalString(_.get(res, "data.id", null)) || normalizedBillingAccountId,
        endDate: normalizeOptionalString(_.get(res, "data.endDate", null)),
        status: normalizeOptionalString(_.get(res, "data.status", null)),
        totalBudgetRemaining: normalizeOptionalNumber(
          _.get(res, "data.totalBudgetRemaining", null)
        ),
      };
    } catch (err) {
      const responseCode = _.get(err, "response.status");

      if (responseCode === HttpStatus.NOT_FOUND) {
        return null;
      }

      logger.debug(
        `projectHelper.getBillingAccountDetails: error for billingAccountId ${normalizedBillingAccountId} - status ${
          responseCode || "n/a"
        }: ${err.message}`
      );
      throw err;
    }
  }

  /**
   * Locks the current challenge member-payment budget against a billing account.
   *
   * The billing-account ledger stores amounts after markup is applied. This
   * helper accepts the member-payment amount from challenge persistence,
   * applies the billing markup, and writes one CHALLENGE lock row keyed by the
   * challenge id.
   *
   * @param {object} params Lock request parameters.
   * @param {string|number} params.billingAccountId Billing-account identifier.
   * @param {string} params.challengeId Challenge id to use as the external reference.
   * @param {number|string} params.memberPaymentAmount Challenge member-payment amount before markup.
   * @param {number|string|null|undefined} params.markup Billing-account markup as a decimal or percentage.
   * @returns {Promise<object>} Billing Accounts API lock response.
   * @throws {errors.BadRequestError} When required values are missing or invalid.
   * @throws {Error} When the Billing Accounts API rejects the lock request.
   */
  async lockChallengeBillingAccountAmount({
    billingAccountId,
    challengeId,
    memberPaymentAmount,
    markup,
  }) {
    const normalizedBillingAccountId = normalizeOptionalString(billingAccountId);
    const normalizedChallengeId = normalizeOptionalString(challengeId);
    const amount = normalizeOptionalNumber(memberPaymentAmount);
    const normalizedMarkup = normalizeBillingMarkup(markup) || 0;

    if (!normalizedBillingAccountId) {
      throw new errors.BadRequestError("Cannot lock challenge budget without a billing account.");
    }

    if (!normalizedChallengeId) {
      throw new errors.BadRequestError("Cannot lock challenge budget without a challenge id.");
    }

    if (_.isNil(amount) || amount < 0) {
      throw new errors.BadRequestError("Cannot lock challenge budget with an invalid amount.");
    }

    if (normalizedMarkup < 0) {
      throw new errors.BadRequestError("Cannot lock challenge budget with an invalid markup.");
    }

    const token = await m2mHelper.getM2MToken();
    const lockAmount = Number((amount * (1 + normalizedMarkup)).toFixed(4));
    const url = `${config.BILLING_ACCOUNTS_API_URL}/${encodeURIComponent(
      normalizedBillingAccountId
    )}/lock-amount`;
    logger.debug(
      `projectHelper.lockChallengeBillingAccountAmount: PATCH ${url} challengeId=${normalizedChallengeId}`
    );

    const res = await axios.patch(
      url,
      {
        amount: lockAmount,
        challengeId: normalizedChallengeId,
        externalId: normalizedChallengeId,
        externalType: "CHALLENGE",
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    return res.data;
  }
}

module.exports = new ProjectHelper();
