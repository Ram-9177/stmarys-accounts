import * as oidc from 'openid-client';
import { config } from '../config.js';

interface PendingState {
  state: string;
  nonce: string;
  codeVerifier: string;
  college: string;
}

let configuration: oidc.Configuration | null = null;

async function getConfiguration(): Promise<oidc.Configuration> {
  if (!configuration) {
    const issuer = new URL(`https://login.microsoftonline.com/${config.MS_TENANT_ID}/v2.0`);
    configuration = await oidc.discovery(issuer, config.MS_CLIENT_ID, config.MS_CLIENT_SECRET);
  }
  return configuration;
}

function redirectUri(): string {
  return `${config.APP_ORIGIN}/api/auth/sso/microsoft/callback`;
}

/** Microsoft Entra ID sign-in. Users are matched to accounts by their email address. */
export const microsoftSso = {
  async start(college: string): Promise<{ url: string; state: PendingState }> {
    const cfg = await getConfiguration();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state: PendingState = {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      codeVerifier,
      college,
    };
    const url = oidc.buildAuthorizationUrl(cfg, {
      redirect_uri: redirectUri(),
      scope: 'openid profile email',
      response_type: 'code',
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state: state.state,
      nonce: state.nonce,
      prompt: 'select_account',
    });
    return { url: url.href, state };
  },

  async finish(currentUrl: URL, pending: PendingState): Promise<{ email: string; college: string }> {
    const cfg = await getConfiguration();
    const tokens = await oidc.authorizationCodeGrant(cfg, currentUrl, {
      pkceCodeVerifier: pending.codeVerifier,
      expectedState: pending.state,
      expectedNonce: pending.nonce,
    });
    const claims = tokens.claims();
    const email = String(claims?.email ?? claims?.preferred_username ?? '');
    if (!email.includes('@')) throw new Error('Microsoft account has no email address');
    return { email, college: pending.college };
  },
};
