/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  /** "cloudflare-access" when deployed straight to Cloudflare (see wrangler.cloudflare.json). */
  IDENTITY_SOURCE?: string;
  /** Cloudflare Access team domain and application audience tag, for verifying Access tokens. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  /** Present only when Cloudflare Access authenticated this request. */
  access?: { getIdentity(): Promise<{ email?: string; name?: string } | null | undefined> };
}

// The app reads the signed-in user from these headers (see app/chatgpt-auth.ts). On the Sites
// platform and on local dev servers they are set upstream; when deployed straight to Cloudflare,
// they are set here from Cloudflare Access, and anything the browser sent is discarded.
const EMAIL_HEADER = "oai-authenticated-user-email";
const IDENTITY_HEADERS = [EMAIL_HEADER, "oai-authenticated-user-full-name", "oai-authenticated-user-full-name-encoding"];

type AccessKey = JsonWebKey & { kid?: string };
let accessKeyCache: { url: string; keys: AccessKey[]; fetchedAt: number } | null = null;

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function accessSigningKeys(teamDomain: string, refresh: boolean) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (!refresh && accessKeyCache?.url === url && Date.now() - accessKeyCache.fetchedAt < 3_600_000) return accessKeyCache.keys;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load Access signing keys (${response.status})`);
  const { keys } = (await response.json()) as { keys: AccessKey[] };
  accessKeyCache = { url, keys, fetchedAt: Date.now() };
  return keys;
}

/** Verifies the signed token Cloudflare Access attaches to every request it lets through. */
async function emailFromAccessToken(token: string, env: Env): Promise<string | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) return null;
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerPart))) as { alg?: string; kid?: string };
  if (header.alg !== "RS256") return null;
  // Access rotates keys; refetch once if the token was signed with a key we haven't seen.
  const jwk = (await accessSigningKeys(env.ACCESS_TEAM_DOMAIN, false)).find((key) => key.kid === header.kid)
    ?? (await accessSigningKeys(env.ACCESS_TEAM_DOMAIN, true)).find((key) => key.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlDecode(signaturePart), signed))) return null;
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart))) as { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string };
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(env.ACCESS_AUD) || claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  if (!claims.exp || claims.exp < now || (claims.nbf && claims.nbf > now + 60)) return null;
  return claims.email ?? null;
}

async function withAccessIdentity(request: Request, env: Env, ctx: ExecutionContext): Promise<Request> {
  const headers = new Headers(request.headers);
  for (const name of IDENTITY_HEADERS) headers.delete(name);
  let email: string | null = null;
  let source = "none";
  try {
    email = (await ctx.access?.getIdentity())?.email ?? null;
    if (email) source = "ctx.access";
  } catch (error) {
    console.error("ctx.access.getIdentity failed", error);
  }
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!email && token) {
    try {
      email = await emailFromAccessToken(token, env);
      source = email ? "access-token" : "access-token-rejected";
    } catch (error) {
      console.error("Access token check failed", error);
    }
  }
  console.log(`identity source: ${source}; ctx.access present: ${Boolean(ctx.access)}; token present: ${Boolean(token)}`);
  if (email) headers.set(EMAIL_HEADER, email);
  return new Request(request, { headers });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (env.IDENTITY_SOURCE === "cloudflare-access") {
      // Access signs people in before the app runs, so these only need to hand off to it.
      if (url.pathname === "/signout-with-chatgpt") return Response.redirect(new URL("/cdn-cgi/access/logout", url), 302);
      if (url.pathname === "/signin-with-chatgpt") return Response.redirect(new URL("/", url), 302);
      request = await withAccessIdentity(request, env, ctx);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
