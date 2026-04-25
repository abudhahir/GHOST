// src/fetcher/auth.ts

import type { DetectedHost } from '../core/types.js'

export function authHeader(
  token: string | undefined,
  hostType: DetectedHost['type'],
): Record<string, string> {
  if (!token) return {}
  if (hostType === 'bitbucket-cloud') {
    return { Authorization: `Basic ${Buffer.from(token).toString('base64')}` }
  }
  return { Authorization: `Bearer ${token}` }
}
