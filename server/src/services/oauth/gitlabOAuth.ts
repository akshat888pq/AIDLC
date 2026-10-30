const AUTHORIZE_URL = 'https://gitlab.com/oauth/authorize';
const TOKEN_URL = 'https://gitlab.com/oauth/token';

export function getGitLabAuthUrl(state: string): string {
  const clientId = process.env.GITLAB_CLIENT_ID;
  if (!clientId) throw new Error('GITLAB_CLIENT_ID not configured');

  const redirectUri = process.env.GITLAB_REDIRECT_URI || 'http://localhost:3001/api/oauth/gitlab/callback';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope: 'api read_repository write_repository',
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeGitLabCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const clientId = process.env.GITLAB_CLIENT_ID;
  const clientSecret = process.env.GITLAB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET required');

  const redirectUri = process.env.GITLAB_REDIRECT_URI || 'http://localhost:3001/api/oauth/gitlab/callback';

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitLab token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in || 7200,
  };
}

export async function refreshGitLabToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const clientId = process.env.GITLAB_CLIENT_ID;
  const clientSecret = process.env.GITLAB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET required');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitLab token refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in || 7200,
  };
}
