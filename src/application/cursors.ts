import * as z from 'zod/v4';
import { cursorSchema } from '../shared/inputs.js';
import { resultCursorSchema } from '../shared/result-query.js';
import { opaqueCursorSchema } from '../shared/pagination.js';
import { JobError } from './jobs.js';
const schema = z.discriminatedUnion('kind', [
  z.strictObject({ v: z.literal(1), kind: z.literal('audits'), position: cursorSchema }),
  z.strictObject({ v: z.literal(1), kind: z.literal('results'), position: resultCursorSchema }),
]);
export function encodeCursor(value: z.infer<typeof schema>) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
export function decodeCursor(token: string) {
  try {
    opaqueCursorSchema.parse(token);
    const bytes = Buffer.from(token, 'base64url');
    if (bytes.toString('base64url') !== token) throw new Error();
    return schema.parse(JSON.parse(bytes.toString('utf8')));
  } catch {
    throw new JobError('invalid_request', 'Invalid pagination cursor');
  }
}
