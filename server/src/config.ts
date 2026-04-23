import 'dotenv/config';

export interface ProxyPoolEntry {
  id: string;
  url: string | null;
  type: 'direct' | 'datacenter' | 'residential';
  weight: number;
  maxConsecutiveFailures: number;
}

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

const isTest = process.env['NODE_ENV'] === 'test';

export const config = {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  databaseUrl: required('DATABASE_URL'),
  proxyPool: JSON.parse(process.env['PROXY_POOL'] ?? '[{"id":"direct","url":null,"type":"direct","weight":10,"maxConsecutiveFailures":10}]') as ProxyPoolEntry[],
  // In production, PRO_LICENSE_KEY and ADMIN_TOKEN MUST be set via env.
  // The test defaults are only used when NODE_ENV=test.
  proLicenseKey: process.env['PRO_LICENSE_KEY'] ?? (isTest ? 'test-pro-key-123' : required('PRO_LICENSE_KEY')),
  adminToken: process.env['ADMIN_TOKEN'] ?? (isTest ? 'test-admin-token' : required('ADMIN_TOKEN')),
} as const;
