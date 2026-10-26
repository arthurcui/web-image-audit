// Project fetch outcomes without retaining bodies or private transport details.
import type { FetchResult } from '../../shared/audit.js';

export function toFetchMetadata(result: FetchResult): FetchResult {
  // Deliberately exclude body and private transport bookkeeping from public results.
  const {
    url,
    state,
    bytes,
    bytesComplete,
    attempts,
    code,
    message,
    status,
    contentType,
    retryAfterMs,
  } = result;
  return {
    url,
    state,
    bytes,
    bytesComplete,
    attempts,
    ...(code === undefined ? {} : { code }),
    ...(message === undefined ? {} : { message }),
    ...(status === undefined ? {} : { status }),
    ...(contentType === undefined ? {} : { contentType }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}
