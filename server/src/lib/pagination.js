import { z } from "zod";

// ?page=&limit=&sort=field|-field — sort restricted to an allowlist per endpoint
export const paginationQuery = (sortFields, defaultSort) =>
  z.strictObject({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(sortFields.flatMap((f) => [f, `-${f}`])).default(defaultSort),
  });

export const toMongoSort = (sort) =>
  sort.startsWith("-") ? { [sort.slice(1)]: -1, _id: -1 } : { [sort]: 1, _id: 1 }; // _id keeps pages stable

export const pageOf = (items, total, { page, limit }) => ({
  items,
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});
