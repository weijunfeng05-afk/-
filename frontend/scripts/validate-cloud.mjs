if (process.env.NETLIFY === 'true') {
  let url;
  try { url = new URL(process.env.VITE_API_BASE_URL || ''); } catch {}
  if (!url || url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash || ['localhost','127.0.0.1'].includes(url.hostname)) {
    throw new Error('Netlify requires VITE_API_BASE_URL=https://your-backend-host (without /api or credentials).');
  }
}
