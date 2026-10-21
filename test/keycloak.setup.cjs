Object.assign(process.env, {M2M_PROVIDER:'keycloak',KEYCLOAK_ISSUER:'https://keycloak.example.test/realms/test',
  KEYCLOAK_AUDIENCE:'https://api.example.test',KEYCLOAK_TOKEN_URL:'https://keycloak.example.test/m2m/token',
  KEYCLOAK_CLIENT_ID:'test-client',KEYCLOAK_CLIENT_SECRET:'synthetic-test-secret',
  AUTH_SECRET:'synthetic-test-member-secret',VALID_ISSUERS:'["https://api.topcoder-dev.com","https://api.topcoder.com"]',ALLOW_LEGACY_USER_AUDIENCE:'true'});
