const assert = require('node:assert/strict');
const Module = require('node:module');
const http = require('axios').create({ validateStatus: () => true });

describe('Support challenge lookup CORS', () => {
  let server: any;
  let baseUrl: string;

  before(async () => {
    const configPath = require.resolve('../../config/default.js');
    const appPath = require.resolve('../../app');
    const previousConfig = require.cache[configPath];
    const previousApp = require.cache[appPath];
    const previousOrigins = process.env.CORS_ALLOWED_ORIGINS;
    const originalLoad = Module._load;

    try {
      // Exercise the shipped defaults independently of local deployment overrides.
      delete process.env.CORS_ALLOWED_ORIGINS;
      delete require.cache[configPath];
      delete require.cache[appPath];
      const config = require(configPath);
      Module._load = function (name: string, parent: any, ...rest: any[]) {
        if (parent?.filename === appPath) {
          if (name === 'config') return config;
          // Keep the real application middleware; replace only database-backed routes.
          if (name === './app-routes') return (app: any) => {
            app.get('/v6/challenges', (_req: any, res: any) => {
              res.set('X-Total-Pages', '2').json([{ id: 'challenge-1', name: 'Active challenge' }]);
            });
            app.use((_req: any, res: any) => res.status(404).end());
          };
        }
        return originalLoad.call(this, name, parent, ...rest);
      };
      const app = require(appPath);
      await new Promise<void>(resolve => {
        server = app.listen(0, '127.0.0.1', resolve);
      });
      baseUrl = `http://127.0.0.1:${server.address().port}/v6/challenges`
        + '?memberId=12345&page=1&perPage=100&sortBy=name&sortOrder=asc&status=ACTIVE';
    } finally {
      Module._load = originalLoad;
      if (previousOrigins === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
      else process.env.CORS_ALLOWED_ORIGINS = previousOrigins;
      if (previousConfig) require.cache[configPath] = previousConfig;
      else delete require.cache[configPath];
      if (previousApp) require.cache[appPath] = previousApp;
      else delete require.cache[appPath];
    }
  });

  after(async () => {
    if (server) await new Promise<void>(resolve => server.close(resolve));
  });

  for (const origin of ['https://support.topcoder.com', 'https://support.topcoder-dev.com']) {
    it(`accepts an authenticated lookup preflight from ${origin}`, async () => {
      const response = await http.request({
        url: baseUrl,
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'app-version,authorization,content-type',
        },
      });

      assert.equal(response.status, 204);
      assert.equal(response.headers['access-control-allow-origin'], origin);
      assert.ok(response.headers['access-control-allow-methods']?.split(',').includes('GET'));
      assert.equal(response.headers['access-control-allow-headers'], 'app-version,authorization,content-type');
    });

    it(`exposes challenge results and pagination headers to ${origin}`, async () => {
      const response = await http.request({ url: baseUrl, headers: { Origin: origin } });

      assert.equal(response.status, 200);
      assert.equal(response.headers['access-control-allow-origin'], origin);
      assert.ok(response.headers['access-control-expose-headers']?.split(',').includes('X-Total-Pages'));
      assert.equal(response.headers['x-total-pages'], '2');
      assert.deepEqual(response.data, [{ id: 'challenge-1', name: 'Active challenge' }]);
    });
  }

  for (const origin of ['https://support.topcoder.com.example.org', 'http://support.topcoder.com']) {
    it(`continues to deny unlisted origin ${origin}`, async () => {
      const response = await http.request({
        url: baseUrl,
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
      });

      assert.equal(response.status, 404);
      assert.equal(response.headers['access-control-allow-origin'], undefined);
    });
  }
});
