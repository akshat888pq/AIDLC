const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

export function getGitHubAuthUrl(state: string): string {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) throw new Error('GITHUB_CLIENT_ID not configured');

  const redirectUri = process.env.GITHUB_REDIRECT_URI || 'http://localhost:3001/api/oauth/github/callback';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'repo',
    state,
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeGitHubCode(code: string): Promise<{
  accessToken: string;
}> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET required');

  const redirectUri = process.env.GITHUB_REDIRECT_URI || 'http://localhost:3001/api/oauth/github/callback';

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);

  return { accessToken: data.access_token };
}
