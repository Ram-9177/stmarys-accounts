/**
 * Local stand-in for the UOS shell, for trying Accounts as a UOS module
 * without the platform. Never used in production.
 *
 *   npm run dev:uos -w server -- keys
 *     Prints a throwaway RS256 key pair. Put UOS_AUTH_PUBLIC_KEY and
 *     UOS_DEV_PRIVATE_KEY in server/.env (with UOS_ENABLED=true etc.).
 *
 *   npm run dev:uos -w server -- pass --email principal@smru.in --campus <campus id> [--sub <uos user id>] [--name "..."] [--minutes 15] [--return-to /path]
 *     Signs a module pass like /auth/select-module does and prints the address
 *     the shell would open: APP_ORIGIN/sso-callback#token=<pass>&returnTo=<path>.
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

const [command, ...rest] = process.argv.slice(2);
const arg = (name: string, fallback = '') => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
};

if (process.env.NODE_ENV === 'production') {
  console.error('dev-uos is for local development only.');
  process.exit(1);
}

if (command === 'keys') {
  const kp = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  console.log(`UOS_AUTH_PUBLIC_KEY=${Buffer.from(kp.publicKey).toString('base64')}`);
  console.log(`UOS_DEV_PRIVATE_KEY=${Buffer.from(kp.privateKey).toString('base64')}`);
} else if (command === 'pass') {
  const key = process.env.UOS_DEV_PRIVATE_KEY;
  if (!key) {
    console.error('UOS_DEV_PRIVATE_KEY is not set. Run `npm run dev:uos -w server -- keys` and add both keys to server/.env.');
    process.exit(1);
  }
  const email = arg('email').toLowerCase();
  const campus = arg('campus');
  if (!email || !campus) {
    console.error('Usage: dev:uos -- pass --email <email> --campus <campus id> [--sub <id>] [--name <name>] [--minutes 15]');
    process.exit(1);
  }
  const pem = Buffer.from(key, 'base64').toString('utf8');
  const minutes = Number(arg('minutes', '15'));
  const pass = jwt.sign(
    {
      sub: arg('sub') || `dev-${email}`,
      org_id: process.env.UOS_ORG_ID || 'dev-org',
      campus_id: campus,
      email,
      name: arg('name') || email.split('@')[0],
      jti: randomUUID(),
    },
    pem,
    { algorithm: 'RS256', audience: process.env.UOS_MODULE_ID || 'accounts', expiresIn: Math.round(minutes * 60) },
  );
  // Exactly what the shell opens: <base_url>/sso-callback#token=<pass>[&returnTo=<path>]
  const origin = (process.env.APP_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
  const returnTo = arg('return-to');
  console.log(`${origin}/sso-callback#token=${encodeURIComponent(pass)}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`);
} else {
  console.error('Usage: dev:uos -- keys | pass --email <email> --campus <campus id>');
  process.exit(1);
}
