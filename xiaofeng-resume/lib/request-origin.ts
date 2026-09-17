export function isAllowedRequestOrigin(req: Request, siteUrl = process.env.SITE_URL): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    if (new URL(origin).origin !== origin) return false;
    if (origin === new URL(req.url).origin) return true;
    return !!siteUrl && origin === new URL(siteUrl).origin;
  } catch {
    return false;
  }
}
