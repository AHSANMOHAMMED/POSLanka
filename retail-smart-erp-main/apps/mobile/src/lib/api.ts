import * as SecureStore from 'expo-secure-store'

let apiBase = 'http://localhost:3000'

export function setApiBase(url: string) {
  apiBase = url.replace(/\/$/, '')
}

export function getApiBase() {
  return apiBase
}

export async function getToken() {
  return SecureStore.getItemAsync('poslanka_token')
}

export async function setToken(token: string | null) {
  if (!token) {
    await SecureStore.deleteItemAsync('poslanka_token')
    return
  }
  await SecureStore.setItemAsync('poslanka_token', token)
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const token = await getToken()
  const headers = new Headers(init.headers || {})
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  return fetch(`${apiBase}${path}`, {
    ...init,
    headers,
  })
}
