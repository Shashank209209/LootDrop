import { z } from 'zod';

export const alertTypeSchema = z.enum([
  'PRICE_BELOW',
  'DISCOUNT_ABOVE',
  'ANY_SALE',
  'HISTORICAL_LOW',
]);

const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'currency must be a 3-letter code');
const targetPriceSchema = z
  .number()
  .finite()
  .positive()
  .max(10_000)
  .refine((value) => Number.isInteger(value * 100), 'targetPrice may have at most 2 decimals');
const targetDiscountSchema = z.number().int().min(1).max(100);

const alertBaseShape = {
  gameId: z.string().uuid(),
  storeId: z.string().uuid().optional(),
  currency: currencySchema.default('USD'),
};

export const createAlertRequestSchema = z.discriminatedUnion('alertType', [
  z
    .object({
      ...alertBaseShape,
      alertType: z.literal('PRICE_BELOW'),
      targetPrice: targetPriceSchema,
    })
    .strict(),
  z
    .object({
      ...alertBaseShape,
      alertType: z.literal('DISCOUNT_ABOVE'),
      targetDiscountPercent: targetDiscountSchema,
    })
    .strict(),
  z
    .object({
      ...alertBaseShape,
      alertType: z.literal('ANY_SALE'),
    })
    .strict(),
  z
    .object({
      ...alertBaseShape,
      alertType: z.literal('HISTORICAL_LOW'),
    })
    .strict(),
]);

const queryInteger = (defaultValue: number, min: number, max: number) =>
  z.preprocess((value) => {
    if (value === undefined) return defaultValue;
    if (typeof value !== 'string' || value.trim() === '') return Number.NaN;
    return Number(value);
  }, z.number().int().min(min).max(max));

export const alertsQuerySchema = z
  .object({
    page: queryInteger(1, 1, Number.MAX_SAFE_INTEGER),
    pageSize: queryInteger(20, 1, 50),
  })
  .strict();

export const updateAlertRequestSchema = z
  .object({
    isActive: z.boolean().optional(),
    targetPrice: targetPriceSchema.optional(),
    targetDiscountPercent: targetDiscountSchema.optional(),
  })
  .strict()
  .refine(
    (input) => input.targetPrice === undefined || input.targetDiscountPercent === undefined,
    'Only one target field may be updated at a time',
  )
  .refine(
    (input) =>
      input.isActive !== undefined ||
      input.targetPrice !== undefined ||
      input.targetDiscountPercent !== undefined,
    'At least one alert field must be provided',
  );

export const alertStoreSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});

export const alertCurrentPriceSchema = z.object({
  currentPrice: z.number().finite(),
  regularPrice: z.number().finite().nullable(),
  discountPercent: z.number().int().nullable(),
  currency: currencySchema,
  store: alertStoreSchema,
});

export const alertResponseSchema = z.object({
  id: z.string().uuid(),
  game: z.object({ id: z.string().uuid(), slug: z.string(), title: z.string() }),
  store: alertStoreSchema.nullable(),
  alertType: alertTypeSchema,
  targetPrice: z.number().finite().nullable(),
  targetDiscountPercent: z.number().int().nullable(),
  currency: currencySchema,
  isActive: z.boolean(),
  lastTriggeredAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  current: alertCurrentPriceSchema.nullable(),
});

export const alertsResponseSchema = z.object({
  data: z.array(alertResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
    hasNextPage: z.boolean(),
  }),
});

export const notificationsQuerySchema = z
  .object({
    page: queryInteger(1, 1, Number.MAX_SAFE_INTEGER),
    pageSize: queryInteger(20, 1, 50),
    unreadOnly: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .strict();

export const notificationResponseSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['EMAIL', 'IN_APP']),
  status: z.enum(['PENDING', 'SENT', 'FAILED']),
  message: z.string(),
  priceAtTrigger: z.number().finite(),
  currency: currencySchema,
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  game: z.object({ slug: z.string(), title: z.string() }),
  store: z.object({ name: z.string() }).nullable(),
});

export const notificationsResponseSchema = z.object({
  data: z.array(notificationResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
    hasNextPage: z.boolean(),
  }),
  unreadCount: z.number().int().nonnegative(),
});

export const unreadCountResponseSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
});

export type AlertType = z.infer<typeof alertTypeSchema>;
export type CreateAlertRequest = z.infer<typeof createAlertRequestSchema>;
export type AlertsQuery = z.infer<typeof alertsQuerySchema>;
export type UpdateAlertRequest = z.infer<typeof updateAlertRequestSchema>;
export type AlertResponse = z.infer<typeof alertResponseSchema>;
export type AlertsResponse = z.infer<typeof alertsResponseSchema>;
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;
export type NotificationResponse = z.infer<typeof notificationResponseSchema>;
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;
export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>;
