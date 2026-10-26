// Validate shared audit creation inputs, identifiers, and idempotency keys.
import * as z from 'zod/v4';
import { scanSchema } from './scan.js';
export const auditUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Enter an HTTP or HTTPS URL without embedded credentials.');
export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
export const auditIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const createAuditSchema = z.strictObject({
  url: auditUrlSchema,
  scan: scanSchema.optional(),
});
export const cursorSchema = z.strictObject({
  createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  id: auditIdSchema,
});
export const listAuditsSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(20),
  before: cursorSchema.optional(),
});
export type CreateAuditInput = z.infer<typeof createAuditSchema>;
export type AuditCursor = z.infer<typeof cursorSchema>;
