import * as z from 'zod/v4';
export const opaqueCursorSchema = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+$/);
export const pageInfoSchema = z.strictObject({
  nextCursor: opaqueCursorSchema.nullable(),
  hasMore: z.boolean(),
});
export const pageInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: opaqueCursorSchema.optional(),
  filter: z.enum(['all', 'failed', 'oversized', 'missing_alt']).optional(),
});
export interface Page<T> {
  items: T[];
  page: { nextCursor: string | null; hasMore: boolean };
}
