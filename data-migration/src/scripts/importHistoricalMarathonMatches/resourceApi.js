"use strict";

const trimTrailingSlash = (value) => String(value || "").trim().replace(/\/+$/, "");

const createAuth0TokenProvider = ({
  auth0Url,
  auth0Audience,
  auth0ClientId,
  auth0ClientSecret,
  fetchImpl = fetch,
}) => {
  const normalizedAuth0Url = trimTrailingSlash(auth0Url);
  const audience = String(auth0Audience || "").trim();
  const clientId = String(auth0ClientId || "").trim();
  const clientSecret = String(auth0ClientSecret || "").trim();

  if (!normalizedAuth0Url) {
    throw new Error("AUTH0_URL must be set for Resource API authentication.");
  }
  if (!audience) {
    throw new Error("AUTH0_AUDIENCE must be set for Resource API authentication.");
  }
  if (!clientId) {
    throw new Error("AUTH0_CLIENT_ID must be set for Resource API authentication.");
  }
  if (!clientSecret) {
    throw new Error("AUTH0_CLIENT_SECRET must be set for Resource API authentication.");
  }

  const tokenUrl = normalizedAuth0Url.endsWith("/oauth/token")
    ? normalizedAuth0Url
    : `${normalizedAuth0Url}/oauth/token`;
  let cachedToken = null;
  let expiresAtMs = 0;

  return async () => {
    const now = Date.now();
    if (cachedToken && now < expiresAtMs) {
      return cachedToken;
    }

    const response = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        audience,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to obtain Auth0 token (${response.status} ${response.statusText}).`
      );
    }

    const payload = await response.json();
    const token = payload && payload.access_token ? String(payload.access_token) : "";
    if (!token) {
      throw new Error("Auth0 token response did not include access_token.");
    }
    const expiresInSeconds = Number.parseInt(payload.expires_in, 10);
    const safeExpiresInSeconds = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? expiresInSeconds
      : 3600;
    cachedToken = token;
    expiresAtMs = now + (safeExpiresInSeconds - 60) * 1000;
    return cachedToken;
  };
};

const parseJsonBody = async (response) => {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }
  return response.json();
};

const createResourceApiClient = ({
  baseUrl,
  submitterRoleId,
  getAccessToken,
  fetchImpl = fetch,
}) => {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);
  if (!normalizedBaseUrl) {
    throw new Error("RESOURCES_API_URL must be set.");
  }
  if (!getAccessToken || typeof getAccessToken !== "function") {
    throw new Error("Resource API access token provider is required.");
  }

  const listSubmitterResources = async (challengeId, roleId = submitterRoleId) => {
    const normalizedChallengeId = String(challengeId || "").trim();
    if (!normalizedChallengeId) {
      return [];
    }

    const normalizedRoleId = String(roleId || submitterRoleId || "").trim();
    const perPage = 200;
    const results = [];
    let page = 1;

    while (true) {
      const url = new URL(normalizedBaseUrl);
      url.searchParams.set("challengeId", normalizedChallengeId);
      url.searchParams.set("perPage", String(perPage));
      url.searchParams.set("page", String(page));
      if (normalizedRoleId) {
        url.searchParams.set("roleId", normalizedRoleId);
      }

      const token = await getAccessToken();
      const response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error(
          `Failed to list resources for challenge ${normalizedChallengeId} (${response.status} ${response.statusText}).`
        );
      }

      const payload = await parseJsonBody(response);
      const rows = Array.isArray(payload) ? payload : [];
      if (rows.length === 0) {
        break;
      }
      results.push(...rows);

      const totalPages = Number.parseInt(response.headers.get("x-total-pages"), 10);
      if (Number.isFinite(totalPages) && page >= totalPages) {
        break;
      }
      if (rows.length < perPage) {
        break;
      }
      page += 1;
    }

    return results;
  };

  const createSubmitterResource = async ({ challengeId, memberId, roleId = submitterRoleId }) => {
    const token = await getAccessToken();
    const response = await fetchImpl(normalizedBaseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        challengeId,
        memberId,
        roleId,
      }),
    });

    if (response.status === 409) {
      return null;
    }
    const responseBodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Failed to create submitter resource for challenge ${challengeId} member ${memberId} (${response.status} ${response.statusText})${responseBodyText ? `: ${responseBodyText}` : ""}.`
      );
    }
    if (!responseBodyText) {
      return null;
    }
    try {
      return JSON.parse(responseBodyText);
    } catch {
      return null;
    }
  };

  return {
    listSubmitterResources,
    createSubmitterResource,
  };
};

module.exports = {
  createAuth0TokenProvider,
  createResourceApiClient,
};
