/*
 * 动力系统 · Service Worker（R-23）
 *
 * 策略刻意保持克制：这是一个「动作记录」工具，数据正确性 > 离线花哨。
 * - App Shell（HTML/CSS/JS/图标）：cache-first，带版本号，升级即清旧缓存；
 * - /api/*：一律 network-only，不缓存 —— 离线时宁可看到明确的错误提示，
 *   也不能把上周的假数据当成今天的记录。
 */
const VERSION = 'v1'
const SHELL_CACHE = 'dongli-shell-' + VERSION

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // API 请求绝不缓存（包括 navigate 到 /api 的异常情况）
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/')) {
    event.respondWith(fetch(req))
    return
  }

  // 非同源（如 CDN）直接走网络
  if (url.origin !== self.location.origin && !url.href.startsWith(self.registration.scope)) {
    return
  }

  // SPA 导航请求：离线时也要能打开页面，回落到缓存的 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy))
          return res
        })
        .catch(() => caches.match('./index.html')),
    )
    return
  }

  // 其余静态资源：cache-first，命中即用，未命中取网络并回填
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res.ok && res.type === 'basic') {
              const copy = res.clone()
              caches.open(SHELL_CACHE).then((c) => c.put(req, copy))
            }
            return res
          })
          .catch(() => hit),
    ),
  )
})

/*
 * Web Push（R-23）：服务器有 VAPID 密钥时才会真正收到推送。
 * 必须展示一条通知（userVisibleOnly 的约定），点了聚焦到已有窗口。
 */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: '动力系统', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || '动力系统 · 该到场了'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '十分钟就好。坐下，记一个动作。',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: data.tag || 'dongli-notify',
      renotify: true,
      data: { url: data.url || './' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || './'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
