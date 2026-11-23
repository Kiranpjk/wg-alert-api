import { createDemoApi } from './demo/demoApi'
import { KEY_STORAGE, readStored } from './storage'
import type { Api } from './types'

export class ApiError extends Error {
  constructor(public status: number, public fields: Record<string, string>, message: string) {
    super(message)
  }
}

const base = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '')
export const isDemo = import.meta.env.VITE_DEMO === 'true'

async function request<T>(path: string, method = 'GET', body?: unknown, keyArg?: string): Promise<T> {
  const key = keyArg ?? readStored(KEY_STORAGE) ?? ''
  const headers = new Headers({ Accept: 'application/json' })
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  if (key) {
    try {
      headers.set('X-API-Key', key)
    } catch {
      throw new ApiError(400, {}, 'Enter a valid API key.')
    }
  }
  const response = await fetch(base + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
    signal: method === 'GET' ? AbortSignal.timeout(12_000) : undefined,
    redirect: key ? 'error' : undefined,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const detail = payload?.detail
    const fields: Record<string, string> = Object.create(null)
    if (Array.isArray(detail)) {
      for (const issue of detail) {
        const field = issue.loc?.[1]
        if (typeof field === 'string' && typeof issue.msg === 'string') fields[field] = issue.msg
      }
    }
    const message = response.status === 422
      ? 'The API could not validate this request.'
      : typeof detail === 'string' ? detail : `Request failed (HTTP ${response.status}).`
    throw new ApiError(response.status, fields, message)
  }
  if (response.status === 204) return undefined as T
  return response.json()
}

const httpApi: Api = {
  health: () => request('/health'),
  listSearches: () => request('/searches'),
  getSearch: (id) => request(`/searches/${id}`),
  createSearch: (search) => request('/searches', 'POST', search),
  deleteSearch: (id) => request(`/searches/${id}`, 'DELETE'),
  ingest: (listings, key) => request('/listings', 'POST', listings, key),
  listMatches: (id, unseenOnly = false) => request(`/searches/${id}/matches?unseen_only=${unseenOnly}`),
  markSeen: (id) => request(`/searches/${id}/matches/seen`, 'POST'),
}

export const api: Api = isDemo ? createDemoApi() : httpApi
