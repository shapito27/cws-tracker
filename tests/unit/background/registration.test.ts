import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetChromeMock, chromeMock } from '../../mocks/chrome';
import { ensureDeviceRegistered } from '@/background/registration';
import { SERVER_URL } from '@/shared/types/settings';
import { SettingsManager } from '@/shared/utils/settings';

describe('ensureDeviceRegistered', () => {
  let settings: SettingsManager;

  beforeEach(() => {
    resetChromeMock();
    (globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;
    settings = new SettingsManager();
    vi.spyOn(globalThis, 'fetch').mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates a deviceId on first call', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('550e8400-e29b-41d4-a716-446655440000');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ apiKey: '550e8400-e29b-41d4-a716-446655440000', plan: 'free' }), { status: 201 }),
    );

    await ensureDeviceRegistered();

    const stored = await settings.getWithDefaults();
    expect(stored.deviceId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(stored.serverApiKey).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('registers with the server', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ apiKey: 'test-key', plan: 'free' }), { status: 201 }),
    );

    await ensureDeviceRegistered();

    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER_URL}/auth/register`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.uuid).toBeTruthy();
    expect(typeof body.uuid).toBe('string');
  });

  it('does not re-register if deviceId and serverApiKey are already set', async () => {
    await settings.setMultiple({
      deviceId: 'existing-uuid',
      serverApiKey: 'existing-api-key',
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

    await ensureDeviceRegistered();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-registers if deviceId exists but serverApiKey is missing', async () => {
    await settings.setMultiple({
      deviceId: 'existing-uuid',
      serverApiKey: null,
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ apiKey: 'recovered-key', plan: 'free' }), { status: 200 }),
    );

    await ensureDeviceRegistered();

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.uuid).toBe('existing-uuid');

    const stored = await settings.getWithDefaults();
    expect(stored.serverApiKey).toBe('recovered-key');
  });

  it('does not throw on registration failure (graceful degradation)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network unreachable'));
    await expect(ensureDeviceRegistered()).resolves.toBeUndefined();
  });

  it('does not store serverApiKey if server returns non-OK', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
    );

    await ensureDeviceRegistered();

    const stored = await settings.getWithDefaults();
    expect(stored.serverApiKey).toBeNull();
    // deviceId should still be generated so the next attempt can reuse it
    expect(stored.deviceId).toBeTruthy();
  });
});
