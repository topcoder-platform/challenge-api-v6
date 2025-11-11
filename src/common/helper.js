/**
 * This file defines helper methods
 */
const _ = require("lodash");
const querystring = require("querystring");
const constants = require("../../app-constants");
const errors = require("./errors");
const util = require("util");
const AWS = require("aws-sdk");
const config = require("config");
const axios = require("axios");
const axiosRetry = require("axios-retry");
const busApi = require("topcoder-bus-api-wrapper");
const NodeCache = require("node-cache");
const HttpStatus = require("http-status-codes");
const logger = require("./logger");

const projectHelper = require("./project-helper");
const m2mHelper = require("./m2m-helper");
const { hasAdminRole } = require("./role-helper");

const DISABLED_TOPICS = new Set(constants.DisabledTopics || []);

// Bus API Client
let busApiClient;

AWS.config.update({
  s3: config.AMAZON.S3_API_VERSION,
  // accessKeyId: config.AMAZON.AWS_ACCESS_KEY_ID,
  // secretAccessKey: config.AMAZON.AWS_SECRET_ACCESS_KEY,
  region: config.AMAZON.AWS_REGION,
});

let s3;

// lazy initialization of S3 instance
function getS3() {
  if (!s3) {
    s3 = new AWS.S3();
  }
  return s3;
}

/**
 * Wrap async function to standard express function
 * @param {Function} fn the async function
 * @returns {Function} the wrapped function
 */
function wrapExpress(fn) {
  return function (req, res, next) {
    fn(req, res, next).catch(next);
  };
}

// Internal cache
const internalCache = new NodeCache({ stdTTL: config.INTERNAL_CACHE_TTL });

/**
 * Wrap all functions from object
 * @param obj the object (controller exports)
 * @returns {Object|Array} the wrapped object
 */
function autoWrapExpress(obj) {
  if (_.isArray(obj)) {
    return obj.map(autoWrapExpress);
  }
  if (_.isFunction(obj)) {
    if (obj.constructor.name === "AsyncFunction") {
      return wrapExpress(obj);
    }
    return obj;
  }
  _.each(obj, (value, key) => {
    obj[key] = autoWrapExpress(value);
  });
  return obj;
}

/**
 * Get link for a given page.
 * @param {Object} req the HTTP request
 * @param {Number} page the page number
 * @returns {String} link for the page
 */
function getPageLink(req, page) {
  const q = _.assignIn({}, req.query, { page });
  return `${config.API_BASE_URL}${req.path}?${querystring.stringify(q)}`;
}

/**
 * Set HTTP response headers from result.
 * @param {Object} req the HTTP request
 * @param {Object} res the HTTP response
 * @param {Object} result the operation result
 */
function setResHeaders(req, res, result) {
  const totalPages = Math.ceil(result.total / result.perPage);
  if (parseInt(result.page, 10) > 1) {
    res.set("X-Prev-Page", parseInt(result.page, 10) - 1);
  }
  if (parseInt(result.page, 10) < totalPages) {
    res.set("X-Next-Page", parseInt(result.page, 10) + 1);
  }
  res.set("X-Page", parseInt(result.page, 10));
  res.set("X-Per-Page", result.perPage);
  res.set("X-Total", result.total);
  res.set("X-Total-Pages", totalPages);
  // set Link header
  if (totalPages > 0) {
    let link = `<${getPageLink(req, 1)}>; rel="first", <${getPageLink(
      req,
      totalPages
    )}>; rel="last"`;
    if (parseInt(result.page, 10) > 1) {
      link += `, <${getPageLink(req, parseInt(result.page, 10) - 1)}>; rel="prev"`;
    }
    if (parseInt(result.page, 10) < totalPages) {
      link += `, <${getPageLink(req, parseInt(result.page, 10) + 1)}>; rel="next"`;
    }
    res.set("Link", link);
  }
}

/**
 * Remove invalid properties from the object and hide long arrays
 * @param {Object} obj the object
 * @returns {Object} the new object with removed properties
 * @private
 */
function _sanitizeObject(obj) {
  try {
    return JSON.parse(
      JSON.stringify(obj, (name, value) => {
        if (_.isArray(value) && value.length > 30) {
          return `Array(${value.length})`;
        }
        return value;
      })
    );
  } catch (e) {
    return obj;
  }
}

/**
 * Convert the object into user-friendly string which is used in error message.
 * @param {Object} obj the object
 * @returns {String} the string value
 */
function toString(obj) {
  return util.inspect(_sanitizeObject(obj), { breakLength: Infinity });
}

/**
 * Check if exists.
 *
 * @param {Array} source the array in which to search for the term
 * @param {Array | String} term the term to search
 */
function checkIfExists(source, term) {
  let terms;

  if (!_.isArray(source)) {
    throw new Error("Source argument should be an array");
  }

  source = source.map((s) => s.toLowerCase());

  if (_.isString(term)) {
    terms = term.toLowerCase().split(" ");
  } else if (_.isArray(term)) {
    terms = term.map((t) => t.toLowerCase());
  } else {
    throw new Error("Term argument should be either a string or an array");
  }

  for (let i = 0; i < terms.length; i++) {
    if (source.includes(terms[i])) {
      return true;
    }
  }

  return false;
}

/**
 * Download file from S3
 * @param {String} bucket the bucket name
 * @param {String} key the key name
 * @return {Promise} promise resolved to downloaded data
 */
async function downloadFromFileStack(url) {
  const res = await axios.get(url);
  return {
    data: res.data,
    mimetype: _.get(res, `headers['content-type']`, "application/json"),
  };
}

/**
 * Download file from S3
 * @param {String} bucket the bucket name
 * @param {String} key the key name
 * @return {Promise} promise resolved to downloaded data
 */
async function downloadFromS3(bucket, key) {
  const file = await getS3().getObject({ Bucket: bucket, Key: key }).promise();
  return {
    data: file.Body,
    mimetype: file.ContentType,
  };
}

/**
 * Delete file from S3
 * @param {String} bucket the bucket name
 * @param {String} key the key name
 * @return {Promise} promise resolved to deleted data
 */
async function deleteFromS3(bucket, key) {
  return getS3().deleteObject({ Bucket: bucket, Key: key }).promise();
}

/**
 * Get challenge resources
 * @param {String} challengeId the challenge id
 * @returns {Promise<Array>} the challenge resources
 */
async function getChallengeResources(challengeId, roleId = null) {
  const token = await m2mHelper.getM2MToken();
  const perPage = 100;
  let page = 1;
  let result = [];
  logger.debug(
    `helper.getChallengeResources: start challenge ${challengeId}${roleId ? ` role ${roleId}` : ""}`
  );
  while (true) {
    const url = `${
      config.RESOURCES_API_URL
    }?challengeId=${challengeId}&perPage=${perPage}&page=${page}${
      roleId ? `&roleId=${roleId}` : ""
    }`;
    logger.debug(`helper.getChallengeResources: GET ${url}`);

    let res;
    try {
      res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      logger.debug(
        `helper.getChallengeResources: error page ${page} for challenge ${challengeId} - status ${
          _.get(err, "response.status", "n/a")
        }: ${err.message}`
      );
      throw err;
    }
    logger.debug(
      `helper.getChallengeResources: page ${page} -> status ${res.status}, items ${
        _.get(res, "data.length", 0) || 0
      }`
    );
    if (!res.data || res.data.length === 0) {
      break;
    }
    result = result.concat(res.data);
    page += 1;
    if (res.headers["x-total-pages"] && page > Number(res.headers["x-total-pages"])) {
      break;
    }
  }
  return result;
}

/**
 * Get challenge resources count
 * @param {String} challengeId the challenge id
 * @returns {Promise<Object>} the challenge resources count
 */
async function getChallengeResourcesCount(challengeId, roleId = null) {
  const token = await m2mHelper.getM2MToken();
  const url = `${config.RESOURCES_API_URL}/count?challengeId=${challengeId}${
    roleId ? `&roleId=${roleId}` : ""
  }`;
  logger.debug(`helper.getChallengeResourcesCount: GET ${url}`);
  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    logger.debug(
      `helper.getChallengeResourcesCount: response status ${res.status} for challenge ${challengeId}`
    );
    return res.data;
  } catch (err) {
    logger.debug(
      `helper.getChallengeResourcesCount: error for challenge ${challengeId} - status ${
        _.get(err, "response.status", "n/a")
      }: ${err.message}`
    );
    throw err;
  }
}

/**
 * Create challenge resources
 * @param {String} challengeId the challenge id
 * @param {String} memberId the user's member handle
 * @param {String} roleId the resource role ID to assign
 */
async function createResource(challengeId, memberId, roleId) {
  const token = await m2mHelper.getM2MToken();

  const userObj = {
    challengeId,
    memberId,
    roleId,
  };
  const url = `${config.RESOURCES_API_URL}`;
  const res = await axios.post(url, userObj, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res || false;
}

function exponentialDelay(retryNumber = 0) {
  const delay = Math.pow(2, retryNumber) * 200;
  const randomSum = delay * 0.2 * Math.random(); // 0-20% of the delay
  return delay + randomSum;
}

axiosRetry(axios, {
  retries: `${config.AXIOS_RETRIES}`, // number of retries
  retryCondition: (e) => {
    return (
      e.config.url.indexOf("v5/projects") > 0 &&
      (axiosRetry.isNetworkOrIdempotentRequestError(e) ||
        e.response.status === HttpStatus.TOO_MANY_REQUESTS)
    );
  },
  onRetry: (retryCount, error, requestConfig) =>
    logger.info(
      `${error.message} while calling: ${requestConfig.url} - retry count: ${retryCount}`
    ),
  retryDelay: exponentialDelay,
});

/**
 * Create Project
 * @param {String} name The name
 * @param {String} description The description
 * @param {String} type The type
 * @param {String} token The token
 * @returns
 */
async function createSelfServiceProject(name, description, type, token) {
  const projectObj = {
    name,
    description,
    type,
  };
  if (!token) {
    token = await m2mHelper.getM2MToken();
  }
  const url = `${config.PROJECTS_API_URL}`;
  const res = await axios.post(url, projectObj, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return _.get(res, "data.id");
}

/**
 * Get project id by roundId
 * @param {String} roundId the round id
 */
async function getProjectIdByRoundId(roundId) {
  const url = `${config.CHALLENGE_MIGRATION_APP_URL}/getChallengeProjectId/${roundId}`;
  const res = await axios.get(url);
  return _.get(res, "data.projectId");
}

/**
 * Get project payment
 * @param {String} projectId the project id
 */
async function getProjectPayment(projectId) {
  const token = await m2mHelper.getM2MToken();
  const url = `${config.CUSTOMER_PAYMENTS_URL}`;
  logger.debug(`helper.getProjectPayment: GET ${url} (project ${projectId})`);
  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        referenceId: projectId,
        reference: "project",
      },
    });
    logger.debug(
      `helper.getProjectPayment: response status ${res.status} (records=${
        _.get(res, "data.length", 0) || 0
      })`
    );
    const [payment] = res.data;
    return payment;
  } catch (err) {
    logger.debug(
      `helper.getProjectPayment: error for project ${projectId} - status ${
        _.get(err, "response.status", "n/a")
      }: ${err.message}`
    );
    throw err;
  }
}

/**
 * Charge payment
 * @param {String} paymentId the payment ID
 */
async function capturePayment(paymentId) {
  const token = await m2mHelper.getM2MToken();
  const url = `${config.CUSTOMER_PAYMENTS_URL}/${paymentId}/charge`;
  logger.info(`Calling: ${url} to capture payment`);
  try {
    const res = await axios.patch(url, {}, { headers: { Authorization: `Bearer ${token}` } });
    logger.debug(`helper.capturePayment: response status ${res.status}`);
    logger.debug(`Payment API Response: ${JSON.stringify(res.data)}`);
    if (res.data.status !== "succeeded") {
      throw new Error(`Failed to charge payment. Current status: ${res.data.status}`);
    }
    return res.data;
  } catch (err) {
    logger.debug(
      `helper.capturePayment: error for payment ${paymentId} - status ${
        _.get(err, "response.status", "n/a")
      }: ${err.message}`
    );
    throw err;
  }
}

/**
 * Cancel payment
 * @param {String} paymentId the payment ID
 */
async function cancelPayment(paymentId) {
  const token = await m2mHelper.getM2MToken();
  const url = `${config.CUSTOMER_PAYMENTS_URL}/${paymentId}/cancel`;
  logger.debug(`helper.cancelPayment: PATCH ${url}`);
  try {
    const res = await axios.patch(url, {}, { headers: { Authorization: `Bearer ${token}` } });
    logger.debug(`helper.cancelPayment: response status ${res.status}`);
    if (res.data.status !== "canceled") {
      throw new Error(`Failed to cancel payment. Current status: ${res.data.status}`);
    }
    return res.data;
  } catch (err) {
    logger.debug(
      `helper.cancelPayment: error for payment ${paymentId} - status ${
        _.get(err, "response.status", "n/a")
      }: ${err.message}`
    );
    throw err;
  }
}

/**
 * Generate payments for challenge resources via finance API
 * @param {String|Number} challengeId the challenge id
 * @returns {Boolean} true if the request succeeds, false otherwise
 */
async function generateChallengePayments(challengeId) {
  if (!config.FINANCE_API_URL) {
    logger.warn("helper.generateChallengePayments: FINANCE_API_URL not configured");
    return false;
  }

  const token = await m2mHelper.getM2MToken();
  const url = `${config.FINANCE_API_URL}/challenges/${challengeId}`;
  logger.debug(`helper.generateChallengePayments: POST ${url}`);

  try {
    const res = await axios.post(
      url,
      {},
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    logger.debug(`helper.generateChallengePayments: response status ${res.status}`);
    return res.status >= 200 && res.status < 300;
  } catch (err) {
    logger.debug(
      `helper.generateChallengePayments: error for challenge ${challengeId} - status ${
        _.get(err, "response.status", "n/a")
      }: ${err.message}`
    );
    return false;
  }
}

/**
 * Cancel project
 * @param {String} projectId the project id
 * @param {String} cancelReason the cancel reasonn
 * @param {Object} currentUser the current user
 */
async function cancelProject(projectId, cancelReason, currentUser) {
  let payment = await getProjectPayment(projectId);
  const project = await projectHelper.getProject(projectId, currentUser);
  if (project.status === "cancelled") return; // already canceled
  try {
    payment = await cancelPayment(payment.id);
  } catch (e) {
    logger.debug(`Failed to cancel payment with error: ${e.message}`);
  }
  const token = await m2mHelper.getM2MToken();
  const url = `${config.PROJECTS_API_URL}/${projectId}`;
  logger.debug(`helper.cancelProject: PATCH ${url}`);
  try {
    await axios.patch(
      url,
      {
        cancelReason,
        status: "cancelled",
        details: {
          ...project.details,
          paymentProvider: config.DEFAULT_PAYMENT_PROVIDER,
          paymentId: payment.id,
          paymentIntentId: payment.paymentIntentId,
          paymentAmount: payment.amount,
          paymentCurrency: payment.currency,
          paymentStatus: payment.status,
        },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    logger.debug(`helper.cancelProject: PATCH success for project ${projectId}`);
  } catch (err) {
    logger.debug(
      `helper.cancelProject: error for project ${projectId} - status ${
        _.get(err, "response.status", "n/a")
      }: ${err.message}`
    );
    throw err;
  }
}

/**
 * Activate project
 * @param {String} projectId the project id
 * @param {Object} currentUser the current user
 */
async function activateProject(projectId, currentUser, name, description) {
  let payment;
  let project;
  try {
    payment = await getProjectPayment(projectId);
    project = await projectHelper.getProject(projectId, currentUser);
    if (payment.status !== "succeeded") {
      payment = await capturePayment(payment.id);
    }
  } catch (e) {
    logger.debug(e);
    logger.debug(`Failed to charge payment ${payment.id} with error: ${e.message}`);
    await cancelProject(
      projectId,
      `Failed to charge payment ${payment.id} with error: ${e.message}`,
      currentUser
    );
    throw new Error(`Failed to charge payment ${payment.id} with error: ${e.message}`);
  }
  const token = await m2mHelper.getM2MToken();
  const url = `${config.PROJECTS_API_URL}/${projectId}`;
  logger.debug(`helper.activateProject: PATCH ${url}`);
  let res;
  try {
    res = await axios.patch(
      url,
      {
        name,
        description,
        status: "active",
        details: {
          ...project.details,
          paymentProvider: config.DEFAULT_PAYMENT_PROVIDER,
          paymentId: payment.id,
          paymentIntentId: payment.paymentIntentId,
          paymentAmount: payment.amount,
          paymentCurrency: payment.currency,
          paymentStatus: payment.status,
        },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
  } catch (err) {
    logger.debug(
      `helper.activateProject: error for project ${projectId} - status ${
        _.get(err, "response.status", "n/a")
      }: ${err.message}`
    );
    throw err;
  }
  logger.debug(`helper.activateProject: PATCH success for project ${projectId}`);

  if (res.data && res.data.status === "reviewed") {
    // auto activate if the project goes in reviewed state
    await activateProject(projectId, currentUser, name, description);
  }
}

/**
 * Update self service project info
 * @param {*} projectId the project id
 * @param {*} workItemPlannedEndDate the planned end date of the work item
 * @param {*} currentUser the current user
 */
async function updateSelfServiceProjectInfo(projectId, workItemPlannedEndDate, currentUser) {
  const project = await projectHelper.getProject(projectId, currentUser);
  const payment = await getProjectPayment(projectId);
  const token = await m2mHelper.getM2MToken();
  const url = `${config.PROJECTS_API_URL}/${projectId}`;

  logger.debug(`helper.updateSelfServiceProjectInfo: PATCH ${url}`);
  try {
    await axios.patch(
      url,
      {
        details: {
          ...project.details,
          paymentProvider: config.DEFAULT_PAYMENT_PROVIDER,
          paymentId: payment.id,
          paymentIntentId: payment.paymentIntentId,
          paymentAmount: payment.amount,
          paymentCurrency: payment.currency,
          paymentStatus: payment.status,
          workItemPlannedEndDate,
        },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    logger.debug(
      `helper.updateSelfServiceProjectInfo: PATCH success for project ${projectId}`
    );
  } catch (err) {
    logger.debug(
      `helper.updateSelfServiceProjectInfo: error for project ${projectId} - status ${
        _.get(err, "response.status", "n/a")
      }: ${err.message}`
    );
    throw err;
  }
}

/**
 * Get resource roles
 * @returns {Promise<Array>} the challenge resources
 */
async function getResourceRoles() {
  const token = await m2mHelper.getM2MToken();
  const res = await axios.get(config.RESOURCE_ROLES_API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data || [];
}

/**
 * Check if a user has full access on a challenge
 * @param {String} challengeId the challenge UUID
 * @param {String} userId the user ID
 * @param {Array} challengeResources the challenge resources
 */
async function userHasFullAccess(challengeId, userId, challengeResources) {
  const resourceRoles = await getResourceRoles();
  const rolesWithFullAccess = _.map(
    _.filter(resourceRoles, (r) => r.fullWriteAccess),
    "id"
  );
  if (!challengeResources) {
    challengeResources = await getChallengeResources(challengeId);
  }
  return (
    _.filter(
      challengeResources,
      (r) =>
        _.toString(r.memberId) === _.toString(userId) && _.includes(rolesWithFullAccess, r.roleId)
    ).length > 0
  );
}

/**
 * Get all user groups
 * @param {String} userId the user id
 * @returns {Promise<Array>} the user groups
 */
async function getUserGroups(userId) {
  const token = await m2mHelper.getM2MToken();
  let allGroups = [];
  // get search is paginated, we need to get all pages' data
  let page = 1;
  while (true) {
    const result = await axios.get(config.GROUPS_API_URL, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        page,
        perPage: 5000,
        memberId: userId,
        membershipType: "user",
      },
    });
    const groups = result.data || [];
    if (groups.length === 0) {
      break;
    }
    allGroups = allGroups.concat(groups);
    page += 1;
    if (result.headers["x-total-pages"] && page > Number(result.headers["x-total-pages"])) {
      break;
    }
  }
  return allGroups;
}

/**
 * Get all user groups including all parent groups for each child group
 * @param {String} userId the user id
 * @returns {Promise<Array>} the user groups
 */
async function getCompleteUserGroupTreeIds(userId) {
  const token = await m2mHelper.getM2MToken();
  const url = `${config.GROUPS_API_URL}/memberGroups/${userId}`;
  logger.debug(`helper.getCompleteUserGroupTreeIds: GET ${url}`);
  try {
    const result = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        uuid: true,
      },
    });

    const normalizedGroupIds = normalizeGroupIdsFromResponse(result.data);
    logger.debug(
      `helper.getCompleteUserGroupTreeIds: response status ${result.status} (groups=${
        normalizedGroupIds.length
      })`
    );
    return normalizedGroupIds;
  } catch (err) {
    logger.debug(
      `helper.getCompleteUserGroupTreeIds: error for user ${userId} - status ${
        _.get(err, "response.status", "n/a")
      }: ${err.message}`
    );
    throw err;
  }
}

/**
 * Normalize group payload into a flat list of group identifier strings.
 *
 * @param {Array|Object|String|Number} groupPayload raw response from Groups API
 * @returns {Array<String>} normalized group identifiers
 */
function normalizeGroupIdsFromResponse(groupPayload) {
  const ids = new Set();

  const pushId = (value) => {
    if (_.isNil(value)) {
      return;
    }
    if (typeof value === "number" || typeof value === "bigint") {
      ids.add(value.toString());
      return;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      const lowered = trimmed.toLowerCase();
      if (lowered === "null" || lowered === "undefined") {
        return;
      }
      ids.add(trimmed);
    }
  };

  const visit = (payload, depth = 0) => {
    if (_.isNil(payload) || depth > 6) {
      return;
    }
    if (Array.isArray(payload)) {
      payload.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (_.isPlainObject(payload)) {
      const identifierKeys = ["id", "groupId", "oldId", "legacyId", "uuid"];
      identifierKeys.forEach((key) => {
        if (!_.isNil(payload[key])) {
          pushId(payload[key]);
        }
      });

      const nestedKeys = [
        "path",
        "pathIds",
        "pathGroupIds",
        "parentGroups",
        "ancestors",
        "ancestorGroupIds",
        "subGroups",
        "children",
        "groupIds",
        "membershipGroupIds",
      ];
      nestedKeys.forEach((key) => {
        if (!_.isNil(payload[key])) {
          visit(payload[key], depth + 1);
        }
      });
      return;
    }

    pushId(payload);
  };

  visit(groupPayload);
  return Array.from(ids);
}

/**
 * Get all subgroups for the given group ID
 * @param {String} groupId the group ID
 * @returns {Array<String>} an array with the groups ID and the IDs of all subGroups
 */
async function expandWithSubGroups(groupId) {
  const token = await m2mHelper.getM2MToken();
  const result = await axios.get(`${config.GROUPS_API_URL}/${groupId}`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      includeSubGroups: true,
    },
  });
  const groups = result.data || {};
  return [groupId, ..._.map(_.get(groups, "subGroups", []), "id")];
}

/**
 * Get the "up the chain" group tree for the given group ID
 * @param {String} groupId the group ID
 * @returns {Array<String>} an array with the group ID and the IDs of all parent groups up the chain
 */
async function expandWithParentGroups(groupId) {
  const token = await m2mHelper.getM2MToken();
  const result = await axios.get(`${config.GROUPS_API_URL}/${groupId}`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      includeParentGroup: true,
      oneLevel: false,
    },
  });

  const ids = [];
  const extractIds = (group) => {
    ids.push(group.id);
    _.each(_.get(group, "parentGroups", []), (parent) => {
      extractIds(parent);
    });
  };

  extractIds(result.data || {});
  return ids;
}

/**
 * Ensures there are no duplicate or null elements in given array.
 * @param {Array} arr the array to check
 * @param {String} name the array name
 */
function ensureNoDuplicateOrNullElements(arr, name) {
  const a = arr || [];
  for (let i = 0; i < a.length; i += 1) {
    if (_.isNil(a[i])) {
      throw new errors.BadRequestError(`There is null element for ${name}.`);
    }
    for (let j = i + 1; j < a.length; j += 1) {
      if (a[i] === a[j]) {
        throw new errors.BadRequestError(`There are duplicate elements (${a[i]}) for ${name}.`);
      }
    }
  }
}

/**
 * Get Bus API Client
 * @return {Object} Bus API Client Instance
 */
function getBusApiClient() {
  // if there is no bus API client instance, then create a new instance
  if (!busApiClient) {
    busApiClient = busApi(
      _.pick(config, [
        "AUTH0_URL",
        "AUTH0_AUDIENCE",
        "TOKEN_CACHE_TIME",
        "AUTH0_CLIENT_ID",
        "AUTH0_CLIENT_SECRET",
        "BUSAPI_URL",
        "KAFKA_ERROR_TOPIC",
        "AUTH0_PROXY_SERVER_URL",
      ])
    );
  }

  return busApiClient;
}

/**
 * Post bus event.
 * @param {String} topic the event topic
 * @param {Object} payload the event payload
 * @param {Object} options the extra options to the message
 */
async function postBusEvent(topic, payload, options = {}) {
  if (DISABLED_TOPICS.has(topic)) {
    logger.debug(`helper.postBusEvent: skipping disabled topic ${topic}`);
    return;
  }
  const client = getBusApiClient();
  const message = {
    topic,
    originator: constants.EVENT_ORIGINATOR,
    timestamp: new Date().toISOString(),
    "mime-type": constants.EVENT_MIME_TYPE,
    payload,
  };
  if (options.key) {
    message.key = options.key;
  }
  logger.debug(
    `helper.postBusEvent: publishing topic ${topic}${options.key ? ` key ${options.key}` : ""}`
  );
  try {
    await client.postEvent(message);
    logger.debug(`helper.postBusEvent: publish complete for topic ${topic}`);
  } catch (err) {
    logger.debug(
      `helper.postBusEvent: error publishing topic ${topic} - ${err.message}`
    );
    throw err;
  }
}

/**
 * Calculates challenge end date based on its phases
 * @param {any} challenge
 */
function calculateChallengeEndDate(challenge, data) {
  if (!data) {
    data = challenge;
  }
  let lastPhase = data.phases[data.phases.length - 1];
  return lastPhase.actualEndDate || lastPhase.scheduledEndDate;
  // let phase = data.phases[data.phases.length - 1]
  // if (!phase || (!data.startDate && !challenge.startDate)) {
  //   return data.startDate || challenge.startDate
  // }
  // const phases = (challenge.phases || []).reduce((obj, elem) => {
  //   obj[elem.id] = elem
  //   return obj
  // }, {})
  // let result = moment(data.startDate || challenge.startDate)
  // while (phase) {
  //   result.add(phase.duration || 0, 'seconds')
  //   phase = phase.predecessor ? phases[phase.predecessor] : null
  // }
  // return result.toDate()
}

/**
 * Lists resources that given member has in the given challenge.
 * @param {Number} memberId the member id
 * @param {String} id the challenge id
 * @returns {Promise<Array>} an array of resources.
 */
async function listResourcesByMemberAndChallenge(memberId, challengeId) {
  const token = await m2mHelper.getM2MToken();
  let response = {};
  try {
    response = await axios.get(config.RESOURCES_API_URL, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        memberId,
        challengeId,
      },
    });
  } catch (e) {
    logger.debug(
      `Failed to get resources on challenge ${challengeId} that memberId ${memberId} has`,
      e
    );
  }
  const result = response.data || [];
  return result;
}

/**
 * This functions gets the default terms of use for a given project id
 *
 * @param {Number} projectId The id of the project for which to get the default terms of use
 * @returns {Promise<Array<Number>>} An array containing the ids of the default project terms of use
 */
async function getProjectDefaultTerms(projectId) {
  const token = await m2mHelper.getM2MToken();
  const projectUrl = `${config.PROJECTS_API_URL}/${projectId}`;
  try {
    const res = await axios.get(projectUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data.terms || [];
  } catch (err) {
    if (_.get(err, "response.status") === HttpStatus.NOT_FOUND) {
      throw new errors.BadRequestError(`Project with id: ${projectId} doesn't exist`);
    } else {
      // re-throw other error
      throw err;
    }
  }
}

/**
 * Remove duplicate term entries by "id" and "roleId" combination.
 *
 * @param {Array<Object>} terms list of challenge terms
 * @returns {Array<Object>} unique term definitions
 */
function dedupeChallengeTerms(terms = []) {
  if (!Array.isArray(terms)) {
    return [];
  }

  return _.uniqBy(
    terms.filter((term) => !_.isNil(term)),
    (term) => {
      const idKey = _.toString(term.id).trim();
      const roleKey = _.isNil(term.roleId) ? "" : _.toString(term.roleId).trim();
      return `${idKey}:${roleKey}`;
    }
  );
}

/**
 * This function gets the challenge terms array with the terms data
 * The terms data is retrieved from the terms API using the specified terms ids
 *
 * @param {Array<Object>} terms The array of terms {id, roleId} to retrieve from terms API
 */
async function validateChallengeTerms(terms = []) {
  const uniqueTerms = dedupeChallengeTerms(terms);
  if (uniqueTerms.length === 0) {
    return [];
  }
  const listOfTerms = [];
  const token = await m2mHelper.getM2MToken();
  for (let term of uniqueTerms) {
    // Get the terms details from the API
    try {
      await axios.get(`${config.TERMS_API_URL}/${term.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      listOfTerms.push(term);
    } catch (e) {
      if (_.get(e, "response.status") === HttpStatus.NOT_FOUND) {
        throw new errors.BadRequestError(
          `Terms of use identified by the id ${term.id} does not exist`
        );
      } else {
        // re-throw other error
        throw e;
      }
    }
  }

  return listOfTerms;
}

/**
 * Filter challenges by groups access
 * @param {Object} currentUser the user who perform operation
 * @param {Array} challenges the challenges to filter
 * @returns {Array} the challenges that can be accessed by current user
 */
async function _filterChallengesByGroupsAccess(currentUser, challenges) {
  const res = [];
  const needToCheckForGroupAccess = !currentUser
    ? true
    : !currentUser.isMachine && !hasAdminRole(currentUser);
  if (!needToCheckForGroupAccess) return challenges;

  let userGroups;

  for (const challenge of challenges) {
    challenge.groups = _.filter(
      challenge.groups,
      (g) => !_.includes(["null", "undefined"], _.toString(g).toLowerCase())
    );
    if (
      !challenge.groups ||
      _.get(challenge, "groups.length", 0) === 0 ||
      !needToCheckForGroupAccess
    ) {
      res.push(challenge);
    } else if (currentUser) {
      if (_.isNil(userGroups)) {
        userGroups = await getCompleteUserGroupTreeIds(currentUser.userId);
      }
      // get user groups if not yet
      if (_.find(challenge.groups, (group) => !!_.find(userGroups, (ug) => ug === group))) {
        res.push(challenge);
      }
    }
  }
  return res;
}

/**
 * Ensure the user can access the challenge by groups access
 * @param {Object} currentUser the user who perform operation
 * @param {Object} challenge the challenge to check
 */
async function ensureAccessibleByGroupsAccess(currentUser, challenge) {
  const filtered = await _filterChallengesByGroupsAccess(currentUser, [challenge]);
  if (filtered.length === 0) {
    throw new errors.ForbiddenError(
      "helper ensureAcessibilityToModifiedGroups :: You don't have access to this group!"
    );
  }
}

/**
 * Ensure the user can access a task challenge.
 *
 * @param {Object} currentUser the user who perform operation
 * @param {Object} challenge the challenge to check
 */
async function _ensureAccessibleForTaskChallenge(currentUser, challenge) {
  let memberResources;
  // Check if challenge is task and apply security rules
  if (_.get(challenge, "task.isTask", false) && _.get(challenge, "task.isAssigned", false)) {
    if (currentUser) {
      if (!currentUser.isMachine) {
        memberResources = await listResourcesByMemberAndChallenge(currentUser.userId, challenge.id);
      }
    }
    const canAccesChallenge = _.isUndefined(currentUser)
      ? false
      : currentUser.isMachine || hasAdminRole(currentUser) || !_.isEmpty(memberResources);
    if (!canAccesChallenge) {
      throw new errors.ForbiddenError(`You don't have access to view this challenge`);
    }
  }
}

/**
 * Ensure the user can view a challenge.
 *
 * @param {Object} currentUser the user who perform operation
 * @param {Object} challenge the challenge to check
 */
async function ensureUserCanViewChallenge(currentUser, challenge) {
  // check groups authorization
  await ensureAccessibleByGroupsAccess(currentUser, challenge);
  // check if user can access a challenge that is a task
  await _ensureAccessibleForTaskChallenge(currentUser, challenge);
}

/**
 * Ensure user can perform modification to a challenge
 *
 * @param {Object} currentUser the user who perform operation
 * @param {Object} challenge the challenge to check
 * @param {Array} challengeResources the challenge resources
 * @returns {Promise}
 */
async function ensureUserCanModifyChallenge(currentUser, challenge, challengeResources) {
  // check groups authorization
  await ensureAccessibleByGroupsAccess(currentUser, challenge);
  // check full access
  const isUserHasFullAccess = await userHasFullAccess(
    challenge.id,
    currentUser.userId,
    challengeResources
  );
  const challengeCreator = _.isNil(challenge.createdBy)
    ? null
    : _.toString(challenge.createdBy);
  const currentUserId = _.isNil(currentUser.userId) ? null : _.toString(currentUser.userId);
  const currentUserHandle = currentUser.handle ? _.toLower(currentUser.handle) : null;
  const isChallengeCreator =
    (!!challengeCreator && !!currentUserId && challengeCreator === currentUserId) ||
    (!!challengeCreator && !!currentUserHandle && _.toLower(challengeCreator) === currentUserHandle);
  if (
    !currentUser.isMachine &&
    !hasAdminRole(currentUser) &&
    !isChallengeCreator &&
    !isUserHasFullAccess
  ) {
    throw new errors.ForbiddenError(
      `Only M2M, admin, challenge's copilot or users with full access can perform modification.`
    );
  }
}

/**
 * Calculate the sum of prizes.
 *
 * @param {Array} prizes the list of prize
 * @returns {Number} the result prize
 */
function sumOfPrizes(prizes) {
  let sum = 0;
  if (!prizes.length) {
    return sum;
  }
  for (const prize of prizes) {
    sum += prize.value;
  }
  return sum;
}

/**
 * Get group by id
 * @param {String} groupId the group id
 * @returns {Promise<Object>} the group
 */
async function getGroupById(groupId) {
  const token = await m2mHelper.getM2MToken();
  try {
    const result = await axios.get(`${config.GROUPS_API_URL}/${groupId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return result.data;
  } catch (err) {
    if (err.response.status === HttpStatus.NOT_FOUND) {
      return;
    }
    throw err;
  }
}

/**
 * Get challenge submissions
 * @param {String} challengeId the challenge id
 * @returns {Promise<Array>} the submission
 */
async function getChallengeSubmissions(challengeId) {
  const token = await m2mHelper.getM2MToken();
  console.log(`Token: ${token}`);
  let allSubmissions = [];
  // get search is paginated, we need to get all pages' data
  let page = 1;
  while (true) {
    const result = await axios.get(`${config.SUBMISSIONS_API_URL}?challengeId=${challengeId}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        page,
        perPage: 100,
      },
    });
    const ids = result.data.data || [];
    if (ids.length === 0) {
      break;
    }
    allSubmissions = allSubmissions.concat(ids);
    page += 1;
    if (result.data.meta.totalPages && page > result.data.meta.totalPages) {
      break;
    }
  }
  return allSubmissions;
}

/**
 * Get review summations for a challenge
 * @param {String} challengeId the challenge ID
 * @returns {Promise<Array>}
 */
async function getReviewSummations(challengeId) {
  const token = await m2mHelper.getM2MToken();
  let allReviewSummations = [];
  let page = 1;
  while (true) {
    const result = await axios.get(`${config.REVIEW_SUMMATIONS_API_URL}?challengeId=${challengeId}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        page,
        perPage: 500,
      },
    });
    const reviewSummations = result.data.data || [];
    if (reviewSummations.length === 0) {
      break;
    }
    allReviewSummations = allReviewSummations.concat(reviewSummations);
    page += 1;
    if (result.data.meta.totalPages && page > result.data.meta.totalPages) {
      break;
    }
  }
  return allReviewSummations;
}

/**
 * Get member by ID
 * @param {String} userId the user ID
 * @returns {Object}
 */
async function getMemberById(userId) {
  const token = await m2mHelper.getM2MToken();
  console.log(`${config.MEMBERS_API_URL}?userId=${userId}`);
  const res = await axios.get(`${config.MEMBERS_API_URL}?userId=${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(res.data);
  if (res.data.length > 0) return res.data[0];
  return {};
}

/**
 * Get member by handle
 * @param {String} handle the user handle
 * @returns {Object}
 */
async function getMemberByHandle(handle) {
  const token = await m2mHelper.getM2MToken();
  const res = await axios.get(`${config.MEMBERS_API_URL}/${handle}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data || {};
}

/**
 * Get members by handles
 * @param {Array<String>} handles the user handle
 * @returns {Object}
 */
async function getMembersByHandles(handles) {
  const token = await m2mHelper.getM2MToken();
  const res = await axios.get(
    `${config.MEMBERS_API_URL}/?fields=handle&handlesLower=["${_.join(handles, '","')}"]`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  return res.data;
}

/**
 * Get standard skills by ids
 * @param {Array<String>} ids the skills ids
 * @returns {Object}
 */
async function getStandSkills(ids) {
  const queryBatches = [];
  const skillIdArg = "&skillId=";
  let queryString = "disablePagination=true";

  for (const id of ids) {
    const enid = encodeURIComponent(id);
    // When many skill ids, the query string will exceed 2048 limit
    if (queryString.length + skillIdArg.length + enid.length < 2048) {
      queryString += skillIdArg + enid;
    } else {
      queryBatches.push(queryString);
      queryString = "disablePagination=true" + skillIdArg + enid;
    }
  }
  queryBatches.push(queryString);

  const skillDataPromises = [];
  for (const batch of queryBatches) {
    skillDataPromises.push(
      (async () => {
        const requestUrl = `${config.API_BASE_URL}/v5/standardized-skills/skills?${batch}`;
        logger.debug(`helper.getStandSkills: GET ${requestUrl}`);
        try {
          const res = await axios.get(requestUrl);
          logger.debug(
            `helper.getStandSkills: response status ${res.status} (items=${
              _.get(res, "data.length", 0) || 0
            })`
          );
          return res.data;
        } catch (err) {
          logger.debug(
            `helper.getStandSkills: error fetching skills batch - status ${
              _.get(err, "response.status", "n/a")
            }: ${err.message}`
          );
          throw err;
        }
      })()
    );
  }

  const data = await Promise.all(skillDataPromises);
  return _.concat(...data);
}

/**
 * Send self service notification
 * @param {String} type the notification type
 * @param {Array} recipients the array of recipients in { userId || email || handle } format
 * @param {Object} data the data
 */
async function sendSelfServiceNotification(type, recipients, data) {
  try {
    await postBusEvent(constants.Topics.Notifications, {
      notifications: [
        {
          serviceId: "email",
          type,
          details: {
            from: config.EMAIL_FROM,
            recipients: [...recipients],
            cc: [...constants.SelfServiceNotificationSettings[type].cc],
            data: {
              ...data,
              supportUrl: `${config.SELF_SERVICE_APP_URL}/support`,
            },
            sendgridTemplateId: constants.SelfServiceNotificationSettings[type].sendgridTemplateId,
            version: "v3",
          },
        },
      ],
    });
  } catch (e) {
    logger.debug(`Failed to post notification ${type}: ${e.message}`);
  }
}

/**
 * Submit a request to zendesk
 * @param {Object} request the request
 */
async function submitZendeskRequest(request) {
  try {
    const res = await axios.post(
      `${config.ZENDESK_API_URL}/api/v2/requests`,
      {
        request: {
          ...request,
        },
      },
      {
        auth: {
          username: `${request.requester.email}/token`,
          password: config.ZENDESK_API_TOKEN,
        },
      }
    );
    return res.data || {};
  } catch (e) {
    logger.debug(`Failed to submit request: ${e.message}`);
    throw e;
  }
}

function getFromInternalCache(key) {
  return internalCache.get(key);
}

function setToInternalCache(key, value) {
  internalCache.set(key, value);
}

function flushInternalCache() {
  internalCache.flushAll();
}

// remove null property from ret (recursively)
function removeNullProperties(obj) {
  if (typeof obj !== "object" || obj === null || obj instanceof Date) {
    return obj;
  }

  // Handle arrays (map recursively)
  if (Array.isArray(obj)) {
    return obj.map(removeNullProperties).filter((item) => item !== null);
  }

  // Handle objects (remove null properties recursively)
  const result = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = removeNullProperties(obj[key]);
      if (value !== null) {
        result[key] = value;
      }
    }
  }
  return result;
}

module.exports = {
  wrapExpress,
  autoWrapExpress,
  setResHeaders,
  checkIfExists,
  toString,
  downloadFromFileStack,
  downloadFromS3,
  deleteFromS3,
  getChallengeResources,
  getChallengeResourcesCount,
  createResource,
  getUserGroups,
  ensureNoDuplicateOrNullElements,
  dedupeChallengeTerms,
  postBusEvent,
  calculateChallengeEndDate,
  listResourcesByMemberAndChallenge,
  getProjectDefaultTerms,
  validateChallengeTerms,
  expandWithSubGroups,
  getCompleteUserGroupTreeIds,
  expandWithParentGroups,
  getResourceRoles,
  ensureAccessibleByGroupsAccess,
  ensureUserCanViewChallenge,
  ensureUserCanModifyChallenge,
  userHasFullAccess,
  sumOfPrizes,
  getProjectIdByRoundId,
  getGroupById,
  getChallengeSubmissions,
  getReviewSummations,
  getMemberById,
  createSelfServiceProject,
  activateProject,
  cancelProject,
  getProjectPayment,
  capturePayment,
  cancelPayment,
  generateChallengePayments,
  sendSelfServiceNotification,
  getMemberByHandle,
  getMembersByHandles,
  getStandSkills,
  submitZendeskRequest,
  updateSelfServiceProjectInfo,
  getFromInternalCache,
  setToInternalCache,
  flushInternalCache,
  removeNullProperties,
};

logger.buildService(module.exports);
