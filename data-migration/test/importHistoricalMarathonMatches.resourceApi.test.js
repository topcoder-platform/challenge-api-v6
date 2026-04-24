const {
  createAuth0TokenProvider,
  createResourceApiClient,
} = require("../src/scripts/importHistoricalMarathonMatches/resourceApi");

describe("importHistoricalMarathonMatches resource api auth provider", () => {
  test("uses AUTH0_URL directly when it already targets /oauth/token", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ access_token: "token-1", expires_in: 3600 }),
    });

    const getAccessToken = createAuth0TokenProvider({
      auth0Url: "https://topcoder-dev.auth0.com/oauth/token",
      auth0Audience: "https://m2m.topcoder-dev.com/",
      auth0ClientId: "client-id",
      auth0ClientSecret: "client-secret",
      fetchImpl,
    });

    await expect(getAccessToken()).resolves.toBe("token-1");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://topcoder-dev.auth0.com/oauth/token",
      expect.objectContaining({ method: "POST" })
    );
  });

  test("forwards sendEmail when creating submitter resources", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ id: "resource-1" }),
    });

    const client = createResourceApiClient({
      baseUrl: "https://api.topcoder-dev.com/v6/resources",
      submitterRoleId: "submitter-role",
      getAccessToken: async () => "token-1",
      fetchImpl,
    });

    await expect(
      client.createSubmitterResource({
        challengeId: "challenge-1",
        memberId: "12345",
        sendEmail: false,
      })
    ).resolves.toEqual({ id: "resource-1" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.topcoder-dev.com/v6/resources",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          challengeId: "challenge-1",
          memberId: "12345",
          roleId: "submitter-role",
          sendEmail: false,
        }),
      })
    );
  });
});
