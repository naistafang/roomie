import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

// Local stand-in for the hosting platform's "Sign in with ChatGPT". In production the platform
// owns /signin-with-chatgpt and /signout-with-chatgpt and injects the identity headers; locally
// nothing does, so this serves those paths on `vite dev` / `vite preview` only. It is never part
// of the built site: Vite only runs configureServer/configurePreviewServer for local servers.

const COOKIE = "roomie_local_user";
const IDENTITY_HEADERS = [
  "oai-authenticated-user-email",
  "oai-authenticated-user-full-name",
  "oai-authenticated-user-full-name-encoding",
];

// The Cloudflare plugin builds the app's Request from rawHeaders, so keep both views in sync.
function setRequestHeader(req: IncomingMessage, name: string, value: string | null) {
  delete req.headers[name];
  const raw: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() !== name) raw.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
  }
  if (value !== null) {
    req.headers[name] = value;
    raw.push(name, value);
  }
  req.rawHeaders.splice(0, req.rawHeaders.length, ...raw);
}

function readCookie(header: string | undefined, name: string) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function redirect(res: ServerResponse, location: string, cookie: string) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.setHeader("Set-Cookie", cookie);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

function signInPage(returnTo: string, error: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in (local testing)</title>
<style>
  body { display: grid; min-height: 100svh; margin: 0; place-items: center; padding: 16px; box-sizing: border-box; background: #f5f7fb; color: #172648; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  form { display: grid; width: min(100%, 400px); gap: 14px; padding: 28px 22px; box-sizing: border-box; border: 1px solid #e0e6f0; border-radius: 24px; background: #fff; }
  h1 { margin: 0; font-size: 22px; }
  p { margin: 0; color: #68758c; font-size: 14px; line-height: 1.45; }
  .note { padding: 10px 12px; border-radius: 12px; background: #fff6dc; color: #7a5a00; font-size: 13px; }
  .error { color: #c3373f; }
  input { min-height: 48px; padding: 0 14px; border: 1px solid #d6deeb; border-radius: 12px; font-size: 16px; }
  button { min-height: 50px; border: 0; border-radius: 14px; background: #172648; color: #fff; font-size: 16px; font-weight: 700; }
</style></head>
<body><form method="get" action="/signin-with-chatgpt">
  <h1>Sign in to Roomie</h1>
  <p class="note">Local testing only. On the live site this is the real “Sign in with ChatGPT”.</p>
  <p>Enter any email to act as that account. Each email has its own listings and bookings.</p>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
  <input type="email" name="email" placeholder="you@example.com" autocomplete="email" required autofocus>
  <input type="hidden" name="return_to" value="${escapeHtml(returnTo)}">
  <button type="submit">Sign in</button>
</form></body></html>`;
}

function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = new URL(req.url ?? "/", "http://localhost");
  // Like the hosting platform, never trust identity headers sent by the browser.
  for (const header of IDENTITY_HEADERS) setRequestHeader(req, header, null);

  if (url.pathname === "/signin-with-chatgpt") {
    const returnTo = safeReturnTo(url.searchParams.get("return_to"));
    const email = url.searchParams.get("email")?.trim() ?? "";
    if (/^[^\s@]+@[^\s@]+$/.test(email)) {
      return redirect(res, returnTo, `${COOKIE}=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(signInPage(returnTo, url.searchParams.has("email") ? "Enter a valid email address." : ""));
    return;
  }
  if (url.pathname === "/signout-with-chatgpt") {
    return redirect(res, safeReturnTo(url.searchParams.get("return_to")), `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  const email = readCookie(req.headers.cookie, COOKIE);
  if (email) setRequestHeader(req, "oai-authenticated-user-email", email);
  next();
}

export function localSignIn(): Plugin {
  return {
    name: "roomie-local-sign-in",
    // Run before vinext and the Cloudflare plugin so identity is set before the app sees the request.
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}
