// src/fetcher/host-prober.ts

import { fetch } from 'undici'
import type { HostType } from '../core/types.js'

type ProbedHostType = Extract<
  HostType,
  'github-enterprise' | 'gitlab' | 'gitea' | 'bitbucket-server'
>

interface Probe {
  path: string
  type: ProbedHostType
  validate: (body: unknown) => boolean
}

const PROBES: Probe[] = [
  {
    path: '/api/v3',
    type: 'github-enterprise',
    validate: (body) =>
      typeof body === 'object' && body !== null && 'current_user_url' in body,
  },
  {
    path: '/api/v4/version',
    type: 'gitlab',
    validate: () => true,
  },
  {
    path: '/api/v1/version',
    type: 'gitea',
    validate: () => true,
  },
  {
    path: '/rest/api/1.0/application-properties',
    type: 'bitbucket-server',
    validate: () => true,
  },
]

async function tryProbe(
  base: string,
  probe: Probe,
  token: string | undefined,
): Promise<ProbedHostType | null> {
  try {
    const headers: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {}
    const res = await fetch(`${base}${probe.path}`, { headers })
    if (!res.ok) return null
    const body = await res.json()
    return probe.validate(body) ? probe.type : null
  } catch {
    return null
  }
}

export async function probeHost(
  base: string,
  token: string | undefined,
): Promise<ProbedHostType | null> {
  const results = await Promise.all(
    PROBES.map((p) => tryProbe(base, p, token)),
  )
  return results.find((r) => r !== null) ?? null
}
