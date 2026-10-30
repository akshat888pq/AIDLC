const AUTHORIZE_URL = 'https://app.vssps.visualstudio.com/oauth2/authorize';
const TOKEN_URL = 'https://app.vssps.visualstudio.com/oauth2/token';

export function getAzureAuthUrl(state: string): string {
  const clientId = process.env.AZURE_CLIENT_ID;
  const redirectUri = process.env.AZURE_REDIRECT_URI || 'http://localhost:3001/api/oauth/azure/callback';

  if (!clientId) throw new Error('AZURE_CLIENT_ID not configured');

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'Assertion',
    state,
    scope: 'vso.work_full vso.project',
    redirect_uri: redirectUri,
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeAzureCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const redirectUri = process.env.AZURE_REDIRECT_URI || 'http://localhost:3001/api/oauth/azure/callback';

  if (!clientSecret) throw new Error('AZURE_CLIENT_SECRET not configured');

  const body = new URLSearchParams({
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientSecret,
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Azure token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in || 3600,
  };
}

export async function refreshAzureToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const redirectUri = process.env.AZURE_REDIRECT_URI || 'http://localhost:3001/api/oauth/azure/callback';

  if (!clientSecret) throw new Error('AZURE_CLIENT_SECRET not configured');

  const body = new URLSearchParams({
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientSecret,
    grant_type: 'refresh_token',
    assertion: refreshToken,
    redirect_uri: redirectUri,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Azure token refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in || 3600,
  };
}
