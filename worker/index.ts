interface Env {
  ASSETS: Fetcher;
}

const ALLOWED_HOSTS = new Set(["fanqienovel.com", "www.fanqienovel.com"]);
const ALLOWED_PATH = /^\/(reader|page)\/\d+\/?$/;

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: securityHeaders });
}

function parseTarget(requestUrl: URL): URL | null {
  const raw = requestUrl.searchParams.get("url");
  if (!raw || raw.length > 500) return null;

  try {
    const target = new URL(raw);
    if (target.protocol !== "https:") return null;
    if (!ALLOWED_HOSTS.has(target.hostname)) return null;
    if (!ALLOWED_PATH.test(target.pathname)) return null;
    target.search = "";
    target.hash = "";
    return target;
  } catch {
    return null;
  }
}

function parseFontTarget(requestUrl: URL): URL | null {
  const raw = requestUrl.searchParams.get("url");
  if (!raw || raw.length > 800) return null;
  try {
    const target = new URL(raw);
    if (target.protocol !== "https:") return null;
    if (!target.hostname.endsWith(".bytetos.com")) return null;
    if (!target.pathname.startsWith("/obj/awesome-font/c/") || !target.pathname.endsWith(".woff2")) return null;
    target.search = "";
    return target;
  } catch {
    return null;
  }
}

async function proxyPage(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ error: "只支持 GET 请求" }, 405);

  const target = parseTarget(new URL(request.url));
  if (!target) return json({ error: "仅支持番茄小说的书籍页或章节页链接" }, 400);

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(`https://cache.local/page?url=${encodeURIComponent(target.href)}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "User-Agent": "Mozilla/5.0 (compatible; FanqieReaderExporter/1.0)",
      },
      redirect: "manual",
    });
  } catch {
    return json({ error: "暂时无法连接内容来源，请稍后重试" }, 502);
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    return json({ error: "内容来源返回了意外跳转" }, 502);
  }
  if (!upstream.ok) return json({ error: `内容来源返回 ${upstream.status}` }, 502);

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return json({ error: "内容来源返回了非网页内容" }, 502);

  const body = await upstream.text();
  if (body.length > 8_000_000) return json({ error: "页面内容超过安全限制" }, 413);

  const response = new Response(body, {
    headers: {
      ...securityHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": target.pathname.startsWith("/page/")
        ? "public, max-age=300, s-maxage=1800"
        : "public, max-age=60, s-maxage=300",
    },
  });
  await cache.put(cacheKey, response.clone());
  return response;
}

async function proxyFont(request: Request): Promise<Response> {
  const target = parseFontTarget(new URL(request.url));
  if (!target) return json({ error: "字体地址不在允许范围内" }, 400);
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(`https://cache.local/font?url=${encodeURIComponent(target.href)}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const upstream = await fetch(target, { redirect: "manual" });
  if (upstream.status >= 300 && upstream.status < 400) return json({ error: "字体来源返回了意外跳转" }, 502);
  if (!upstream.ok) return json({ error: "字体文件读取失败" }, 502);
  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength > 5_000_000) return json({ error: "字体文件超过安全限制" }, 413);
  const response = new Response(bytes, { headers: { ...securityHeaders, "Content-Type": "font/woff2", "Cache-Control": "public, max-age=86400, s-maxage=604800" } });
  await cache.put(cacheKey, response.clone());
  return response;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/page") return proxyPage(request);
    if (url.pathname === "/api/font") return proxyFont(request);
    if (url.pathname === "/api/health") return json({ ok: true });

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    Object.entries(securityHeaders).forEach(([key, value]) => headers.set(key, value));
    headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
} satisfies ExportedHandler<Env>;
