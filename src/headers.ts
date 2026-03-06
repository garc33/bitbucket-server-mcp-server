/**
 * Parse a comma-separated "Key=value,Key2=value2" string into a headers object.
 * Values may contain '=' characters (e.g. Base64 tokens).
 * Returns an empty object for undefined or blank input.
 */
export function parseCustomHeaders(raw: string | undefined): Record<string, string> {
  if (!raw || !raw.trim()) return {};
  return Object.fromEntries(
    raw.split(',')
      .map(pair => pair.split('='))
      .filter(parts => parts.length >= 2 && parts[0].trim())
      .map(([key, ...rest]) => [key.trim(), rest.join('=').trim()])
  );
}
