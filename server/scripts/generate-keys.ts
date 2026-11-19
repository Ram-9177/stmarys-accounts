/** Prints a fresh RS256 key pair as base64 for JWT_PRIVATE_KEY / JWT_PUBLIC_KEY. */
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

console.log('# Add these to the server environment (keep the private key secret):');
console.log(`JWT_PRIVATE_KEY=${Buffer.from(privateKey).toString('base64')}`);
console.log(`JWT_PUBLIC_KEY=${Buffer.from(publicKey).toString('base64')}`);
