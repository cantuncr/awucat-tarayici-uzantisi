/**
 * Minimal match-pattern check ("scheme://host/path*") — enough to find out whether one of the
 * manifest's content scripts runs on a given URL. Ports are ignored when the pattern has none,
 * exactly like Chrome's match patterns.
 */
export function urlMatchesPattern(url: string, pattern: string): boolean {
  if (pattern === "<all_urls>") return /^(https?|file|ftp|ws|wss):/.test(url);
  const m = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)$/i.exec(pattern);
  if (!m) return false;
  const [, scheme, hostPart, pathPart] = m;
  let u: URL;
  try {
    u = new URL(url.startsWith("blob:") ? url.slice(5) : url);
  } catch {
    return false;
  }
  const scheme_ = u.protocol.slice(0, -1);
  if (scheme === "*" ? !(scheme_ === "http" || scheme_ === "https") : scheme.toLowerCase() !== scheme_) return false;

  const [host, port] = splitHostPort(hostPart);
  if (host === "*") {
    /* any host */
  } else if (host.startsWith("*.")) {
    const suffix = host.slice(2).toLowerCase();
    if (u.hostname !== suffix && !u.hostname.endsWith("." + suffix)) return false;
  } else if (host.toLowerCase() !== u.hostname) {
    return false;
  }
  if (port && port !== "*" && port !== (u.port || defaultPort(scheme_))) return false;

  const path = u.pathname + u.search;
  const re = new RegExp("^" + pathPart.split("*").map(escapeRegExp).join(".*") + "$");
  return re.test(path);
}

function splitHostPort(hostPart: string): [string, string] {
  const i = hostPart.lastIndexOf(":");
  if (i === -1 || hostPart.endsWith("]")) return [hostPart, ""];
  return [hostPart.slice(0, i), hostPart.slice(i + 1)];
}

function defaultPort(scheme: string): string {
  return scheme === "https" ? "443" : scheme === "http" ? "80" : "";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match patterns of the manifest content scripts that include the given file. */
export function patternsForScript(manifest: { content_scripts?: Array<{ matches?: string[]; js?: string[] }> }, file: string): string[] {
  return (manifest.content_scripts ?? []).filter((cs) => cs.js?.includes(file)).flatMap((cs) => cs.matches ?? []);
}
