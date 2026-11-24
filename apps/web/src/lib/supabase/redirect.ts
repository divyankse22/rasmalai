/** Keep the browser on the same origin as the session cookies, including behind a reverse proxy. */
export function redirectAfterAuth(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'private, no-store' },
  });
}
