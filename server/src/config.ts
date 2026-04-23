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

export const config = {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  databaseUrl: required('DATABASE_URL'),
  proxyPool: JSON.parse(process.env['PROXY_POOL'] ?? '[{"id":"direct","url":null,"type":"direct","weight":10,"maxConsecutiveFailures":10}]') as ProxyPoolEntry[],
  proLicenseKey: process.env['PRO_LICENSE_KEY'] ?? 'test-pro-key-123',
} as const;
