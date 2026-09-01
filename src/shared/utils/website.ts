/**
 * Developer website normalization.
 *
 * CWS stores the developer-submitted website verbatim at `ds:0` `card[7]`, so the
 * value is inconsistent across listings: some are full URLs
 * ("https://www.joinhoney.com/", "http://grammarly.com/"), others are bare
 * domains ("wizardstool.com"). These helpers turn that raw value into a display
 * domain and a safe link target.
 *
 * The value is untrusted third-party input that ends up in an `href`, so
 * anything that does not parse as an http(s) URL with a dotted hostname yields
 * `null` rather than being passed through.
 */

/** Only these protocols may reach an `href` (blocks `javascript:`, `data:`). */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Matches a leading scheme like `https://` or `javascript://`. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Parse a raw CWS website value into a URL, or `null` if it is unusable.
 *
 * Schemeless values are assumed to be https. Values that fail to parse, use a
 * non-http(s) protocol, or lack a dotted hostname are rejected.
 */
function parseWebsite(raw: string | null | undefined): URL | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
    // Embedded credentials are never a real website and read as the
    // "https://trusted.com@evil.com" phishing shape. A schemeless value like
    // "mailto:dev@example.com" also lands here once https is prepended.
    if (url.username || url.password) return null;
    // Rejects junk like "n/a" or "coming soon" that would otherwise parse.
    if (!url.hostname.includes('.')) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * The display domain for a raw CWS website value, with any `www.` prefix
 * stripped. Returns `null` when the value is missing or unusable.
 *
 * e.g. "https://www.joinhoney.com/" -> "joinhoney.com"
 *      "wizardstool.com"            -> "wizardstool.com"
 */
export function websiteDomain(raw: string | null | undefined): string | null {
  const url = parseWebsite(raw);
  if (!url) return null;
  return url.hostname.replace(/^www\./, '');
}

/**
 * A safe `href` for a raw CWS website value, or `null` when unusable.
 * The developer's original scheme is preserved; schemeless values get https.
 */
export function websiteHref(raw: string | null | undefined): string | null {
  return parseWebsite(raw)?.href ?? null;
}
