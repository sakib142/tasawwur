import { type NextRequest, NextResponse } from "next/server";

/**
 * Reverse proxy to the generation engine.
 *
 * Everything in the browser talks to same-origin /api/engine/*, so there is no
 * CORS and no engine URL in the client bundle. It is also the seam for the
 * migration: as each service is reimplemented in TypeScript its route stops
 * being proxied here and becomes a real handler, with no client change.
 */
const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:8080/api/v1";

/**
 * Headers that must not reach the engine.
 *
 * The hop-by-hop ones are required by HTTP. The browser-identity ones are a
 * deliberate choice: this proxy is a *server-side* client, and the engine
 * applies CSRF-style origin protection that rejects any request carrying a
 * foreign Origin. Forwarding the browser's Origin made it look like a
 * cross-site attack and was correctly refused. Stripping these presents the
 * request as what it actually is — server to server — and leaves the engine's
 * protection intact for real browsers hitting it directly.
 */
const STRIP = new Set([
  // hop-by-hop
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  // browser identity — see above
  "origin",
  "referer",
  "cookie",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "sec-fetch-user",
]);

function passthrough(headers: Headers): Headers {
  const out = new Headers();
  headers.forEach((v, k) => {
    if (!STRIP.has(k.toLowerCase())) out.set(k, v);
  });
  return out;
}

async function proxy(req: NextRequest, path: string[]) {
  const target = `${ENGINE_URL}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: passthrough(req.headers),
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
      // Renders stream for minutes; never cache.
      cache: "no-store",
    });

    // Stream the body rather than buffering: video responses are large and
    // need range support for seeking.
    return new NextResponse(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: passthrough(upstream.headers),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown error";
    return NextResponse.json(
      {
        status: 502,
        message: `Cannot reach the generation engine at ${ENGINE_URL}. Start it, then retry. (${message})`,
      },
      { status: 502 },
    );
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function HEAD(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
