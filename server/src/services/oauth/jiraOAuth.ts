const AUTHORIZE_URL = 'https://auth.atlassian.com/authorize';
const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';

export function getJiraAuthUrl(state: string): string {
  const clientId = process.env.JIRA_CLIENT_ID;
  const redirectUri = process.env.JIRA_REDIRECT_URI || 'http://localhost:3001/api/oauth/jira/callback';

  if (!clientId) throw new Error('JIRA_CLIENT_ID not configured');

  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: clientId,
    scope: 'read:jira-work write:jira-work read:jira-user offline_access',
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    prompt: 'consent',
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeJiraCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const clientId = process.env.JIRA_CLIENT_ID;
  const clientSecret = process.env.JIRA_CLIENT_SECRET;
  const redirectUri = process.env.JIRA_REDIRECT_URI || 'http://localhost:3001/api/oauth/jira/callback';

  if (!clientId || !clientSecret) throw new Error('JIRA_CLIENT_ID and JIRA_CLIENT_SECRET required');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in || 3600,
  };
}

export async function refreshJiraToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const clientId = process.env.JIRA_CLIENT_ID;
  const clientSecret = process.env.JIRA_CLIENT_SECRET;

  if (!clientId || !clientSecret) throw new Error('JIRA_CLIENT_ID and JIRA_CLIENT_SECRET required');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira token refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in || 3600,
  };
}

export async function getJiraCloudId(accessToken: string): Promise<{ cloudId: string; siteName: string; siteUrl: string }> {
  const res = await fetch(RESOURCES_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) throw new Error('Failed to fetch Jira accessible resources');

  const sites = await res.json();
  if (!sites.length) throw new Error('No Jira sites accessible with this token');

  const site = sites[0];
  return {
    cloudId: site.id,
    siteName: site.name,
    siteUrl: site.url,
  };
}
