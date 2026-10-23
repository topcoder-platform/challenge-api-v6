Object.assign(process.env, {USE_KEYCLOAK:'true',KEYCLOAK_ISSUER:'https://keycloak.example.test/realms/test',
  KEYCLOAK_AUDIENCE:'https://api.example.test',KEYCLOAK_TOKEN_URL:'https://keycloak.example.test/m2m/token',
  KEYCLOAK_CLIENT_ID:'test-client',KEYCLOAK_CLIENT_SECRET:'synthetic-test-secret',
  AUTH_SECRET:'synthetic-test-member-secret',VALID_ISSUERS:'["https://api.topcoder-dev.com","https://api.topcoder.com"]',ALLOW_LEGACY_USER_AUDIENCE:'true'});
// Synthetic Auth0 settings for the USE_KEYCLOAK=false tests. AUTH0_AUDIENCE is empty (so a local
// .env cannot fill it) to exercise the config default.
Object.assign(process.env, {AUTH0_URL:'https://auth0.example.test/oauth/token',AUTH0_AUDIENCE:'',
  AUTH0_PROXY_SERVER_URL:'https://auth0-proxy.example.test/token',TOKEN_CACHE_TIME:'86400000',
  AUTH0_CLIENT_ID:'auth0-test-client',AUTH0_CLIENT_SECRET:'synthetic-auth0-secret'});
