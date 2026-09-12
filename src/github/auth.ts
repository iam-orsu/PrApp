import * as jwt from 'jsonwebtoken';
import axios from 'axios';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

interface InstallationAccessToken {
  token: string;
  expires_at: string;
  permissions: Record<string, string>;
  repositories?: Array<{ id: number; name: string; full_name: string }>;
}

// Cache tokens to avoid excessive generation
const tokenCache = new Map<
  number,
  {
    token: string;
    expiresAt: number;
  }
>();

function createJWT(): string {
  const now = Math.floor(Date.now() / 1000);
  const iat = now;
  const exp = now + 10 * 60; // 10 minutes

  const payload = {
    iss: config.github.appId,
    sub: config.github.appId,
    iat,
    exp,
  };

  // Convert escaped newlines in private key to actual newlines
  // (environment variables can't contain literal newlines, so they're escaped as \n)
  const privateKey = config.github.privateKey.replace(/\\n/g, '\n');

  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
  });
}

export async function getInstallationAccessToken(
  installationId: number
): Promise<string> {
  // Check cache
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now()) {
    logger.debug('Using cached installation token', { installationId });
    return cached.token;
  }

  try {
    const jwt = createJWT();

    const response = await axios.post<InstallationAccessToken>(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {},
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    const token = response.data.token;
    const expiresAt = new Date(response.data.expires_at).getTime();

    // Cache token (expires 1 minute before actual expiration)
    tokenCache.set(installationId, {
      token,
      expiresAt: expiresAt - 60000,
    });

    logger.debug('Generated new installation token', {
      installationId,
      expiresAt: new Date(expiresAt).toISOString(),
    });

    return token;
  } catch (error) {
    logger.error('Failed to get installation access token', error);
    throw new Error('Failed to authenticate with GitHub');
  }
}

export function createGitHubAPI(token: string) {
  const api = axios.create({
    baseURL: 'https://api.github.com',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  return api;
}

export function clearTokenCache(): void {
  tokenCache.clear();
  logger.debug('Token cache cleared');
}
