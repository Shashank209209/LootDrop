import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import {
  bestDealsQuerySchema,
  curatedDealsResponseSchema,
  dealsQuerySchema,
  dealsResponseSchema,
  authSessionResponseSchema,
  freeDealsQuerySchema,
  gameDetailResponseSchema,
  gameSearchQuerySchema,
  gameSearchResponseSchema,
  gameSlugSchema,
  historicalLowsQuerySchema,
  historicalLowsResponseSchema,
  loginRequestSchema,
  meResponseSchema,
  priceHistoryQuerySchema,
  priceHistoryResponseSchema,
  refreshResponseSchema,
  registerRequestSchema,
  storesResponseSchema,
  wishlistAddRequestSchema,
  wishlistIdsResponseSchema,
  wishlistQuerySchema,
  wishlistResponseSchema,
} from '@dealhunter/contracts';
import { z } from 'zod';

extendZodWithOpenApi(z);

const errorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().nullable().optional(),
    }),
  })
  .openapi('ApiError');

const healthSchema = z.object({ status: z.literal('ok') }).openapi('HealthResponse');
const registry = new OpenAPIRegistry();
registry.register('ApiError', errorSchema);
registry.register('HealthResponse', healthSchema);
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

function response(schema: z.ZodTypeAny, description: string) {
  return {
    description,
    content: { 'application/json': { schema } },
  };
}

registry.registerPath({
  method: 'get',
  path: '/api/v1/health',
  summary: 'Check API health',
  responses: { 200: response(healthSchema, 'API is healthy') },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/deals',
  summary: 'List and filter deals',
  request: { query: dealsQuerySchema },
  responses: {
    200: response(dealsResponseSchema, 'Paginated deal results'),
    400: response(errorSchema, 'Invalid query'),
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/stores',
  summary: 'List active stores',
  responses: { 200: response(storesResponseSchema, 'Active stores') },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/games/search',
  summary: 'Search game titles',
  request: { query: gameSearchQuerySchema },
  responses: {
    200: response(gameSearchResponseSchema, 'Matching games, up to 8'),
    400: response(errorSchema, 'Invalid search query'),
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/games/{slug}',
  summary: 'Get game and store comparisons',
  request: { params: z.object({ slug: gameSlugSchema }) },
  responses: {
    200: response(gameDetailResponseSchema, 'Game, current listings and history summary'),
    400: response(errorSchema, 'Invalid game slug'),
    404: response(errorSchema, 'Game not found'),
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/games/{slug}/price-history',
  summary: 'Get price history for a game',
  request: {
    params: z.object({ slug: gameSlugSchema }),
    query: priceHistoryQuerySchema,
  },
  responses: {
    200: response(priceHistoryResponseSchema, 'Price history grouped by listing'),
    400: response(errorSchema, 'Invalid range or store'),
    404: response(errorSchema, 'Game not found'),
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/deals/best',
  summary: 'List best qualifying deals',
  description:
    'Only on-sale listings with a regular price of at least 5 in their own currency. Returns the best listing per game and currency.',
  request: { query: bestDealsQuerySchema },
  responses: {
    200: response(curatedDealsResponseSchema, 'Best deals'),
    400: response(errorSchema, 'Invalid limit'),
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/deals/free',
  summary: 'List legitimate free deals',
  description: 'Current price must be zero and regular price must be greater than zero.',
  request: { query: freeDealsQuerySchema },
  responses: {
    200: response(curatedDealsResponseSchema, 'Free games'),
    400: response(errorSchema, 'Invalid limit'),
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/deals/historical-lows',
  summary: 'List qualifying historical lows',
  description:
    'A listing qualifies when it has at least two snapshots and its current price is no greater than its recorded minimum in the current currency.',
  request: { query: historicalLowsQuerySchema },
  responses: {
    200: response(historicalLowsResponseSchema, 'Historical-low listings'),
    400: response(errorSchema, 'Invalid limit'),
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/register',
  summary: 'Register a user',
  request: { body: { content: { 'application/json': { schema: registerRequestSchema } } } },
  responses: {
    201: response(authSessionResponseSchema, 'User registered and session created'),
    400: response(errorSchema, 'Invalid registration request'),
    409: response(errorSchema, 'Registration unavailable'),
    429: response(errorSchema, 'Too many authentication attempts'),
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/login',
  summary: 'Log in',
  request: { body: { content: { 'application/json': { schema: loginRequestSchema } } } },
  responses: {
    200: response(authSessionResponseSchema, 'Authenticated user and access token'),
    400: response(errorSchema, 'Invalid login request'),
    401: response(errorSchema, 'Invalid email or password'),
    429: response(errorSchema, 'Too many authentication attempts'),
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/refresh',
  summary: 'Rotate refresh token',
  responses: {
    200: response(refreshResponseSchema, 'New access and refresh tokens'),
    401: response(errorSchema, 'Refresh session is invalid'),
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/logout',
  summary: 'Log out and revoke refresh token',
  responses: { 204: { description: 'Refresh session revoked and cookie cleared' } },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/auth/me',
  summary: 'Get current user',
  security: [{ bearerAuth: [] }],
  responses: {
    200: response(meResponseSchema, 'Authenticated user'),
    401: response(errorSchema, 'Authentication required'),
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/wishlist',
  summary: 'List the current user wishlist',
  security: [{ bearerAuth: [] }],
  request: { query: wishlistQuerySchema },
  responses: {
    200: response(wishlistResponseSchema, 'Paginated wishlist'),
    400: response(errorSchema, 'Invalid pagination'),
    401: response(errorSchema, 'Authentication required'),
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/wishlist',
  summary: 'Add a game to the wishlist',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: wishlistAddRequestSchema } } } },
  responses: {
    200: { description: 'Game was already wishlisted' },
    201: { description: 'Game added to wishlist' },
    400: response(errorSchema, 'Invalid request'),
    401: response(errorSchema, 'Authentication required'),
    404: response(errorSchema, 'Game not found'),
  },
});
registry.registerPath({
  method: 'delete',
  path: '/api/v1/wishlist/{gameId}',
  summary: 'Remove a game from the wishlist',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ gameId: z.string().uuid() }) },
  responses: {
    204: { description: 'Wishlist item removed if present' },
    401: response(errorSchema, 'Authentication required'),
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/wishlist/ids',
  summary: 'Get wishlist game IDs',
  security: [{ bearerAuth: [] }],
  responses: {
    200: response(wishlistIdsResponseSchema, 'Up to 1000 wishlisted game IDs'),
    401: response(errorSchema, 'Authentication required'),
  },
});

export function createOpenApiDocument() {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'LootDrop API',
      version: '1.0.0',
      description: 'Read-only deal, store, game search, detail, and price-history endpoints.',
    },
    servers: [{ url: '/' }],
  });
}
