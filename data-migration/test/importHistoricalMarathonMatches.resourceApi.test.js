const {
  createAuth0TokenProvider,
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
});
