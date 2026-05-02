function apiRootUrl(): string | null {
  const raw = import.meta.env.VITE_API_URL as string | undefined
  if (!raw?.trim()) return null
  return `${raw.trim().replace(/\/+$/, '')}/`
}

/** Тестовый GET на корень HTTP API при загрузке (если задан VITE_API_URL). */
export function pingApiOnLoad(): void {
  const url = apiRootUrl()
  if (!url) return

  void fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
    .then(async (res) => {
      const text = await res.text().catch(() => '')
      if (!res.ok) {
        console.warn('[VITE_API_URL]', res.status, text.slice(0, 200))
        return
      }
      try {
        console.debug('[VITE_API_URL]', JSON.parse(text) as unknown)
      } catch {
        console.debug('[VITE_API_URL]', text.slice(0, 200))
      }
    })
    .catch((err: unknown) => {
      console.warn('[VITE_API_URL] request failed', err)
    })
}
