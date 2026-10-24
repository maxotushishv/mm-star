// Vercel Web-standard Function. All /api/* URLs are routed here by vercel.json.
// Preserve the original API path for the existing MM STAR router.
import mmStarApi from '../lib/mm-star-api.mjs';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const route = url.searchParams.get('route');
    if (route !== null) {
      url.searchParams.delete('route');
      url.pathname = '/api/' + route.replace(/^\/+/, '');
    }
    return mmStarApi(new Request(url, request));
  }
};
