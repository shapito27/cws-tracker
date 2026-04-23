import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetChromeMock, chromeMock } from '../../mocks/chrome';
import { useLicense } from '@/dashboard/composables/useLicense';
import { SERVER_URL } from '@/shared/types/settings';
import { SettingsManager } from '@/shared/utils/settings';

describe('useLicense', () => {
  let settings: SettingsManager;

  beforeEach(async () => {
    resetChromeMock();
    (globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;
    settings = new SettingsManager();
    // Seed a valid serverApiKey so activateLicense can auth
    await settings.setMultiple({ serverApiKey: 'test-api-key', deviceId: 'test-uuid' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadLicense', () => {
    it('starts as free when no stored license', async () => {
      const { plan, licenseKey, loadLicense } = useLicense();
      await loadLicense();
      expect(plan.value).toBe('free');
      expect(licenseKey.value).toBeNull();
    });

    it('loads existing Pro status from storage', async () => {
      await settings.setMultiple({
        lemonSqueezyLicense: 'LS-abc',
        subscriptionStatus: 'pro',
      });
      const { plan, licenseKey, loadLicense } = useLicense();
      await loadLicense();
      expect(plan.value).toBe('pro');
      expect(licenseKey.value).toBe('LS-abc');
    });
  });

  describe('activateLicense', () => {
    it('returns true and sets plan=pro on valid license', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ plan: 'pro', validUntil: '2027-01-01' }), { status: 200 }),
      );

      const { plan, licenseKey, activateLicense } = useLicense();
      const ok = await activateLicense('valid-license-key');

      expect(ok).toBe(true);
      expect(plan.value).toBe('pro');
      expect(licenseKey.value).toBe('valid-license-key');

      const stored = await settings.getWithDefaults();
      expect(stored.lemonSqueezyLicense).toBe('valid-license-key');
      expect(stored.subscriptionStatus).toBe('pro');
    });

    it('sends PUT /api/license with X-API-Key and licenseKey body', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ plan: 'pro' }), { status: 200 }),
      );

      const { activateLicense } = useLicense();
      await activateLicense('test-key');

      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/api/license`,
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
          }),
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
      expect(body.licenseKey).toBe('test-key');
    });

    it('returns false on 403 (invalid license)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid' }), { status: 403 }),
      );

      const { plan, activateLicense, error } = useLicense();
      const ok = await activateLicense('bad-key');

      expect(ok).toBe(false);
      expect(plan.value).toBe('free');
      expect(error.value).toContain('Invalid');
    });

    it('returns false on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network'));
      const { activateLicense, error } = useLicense();
      const ok = await activateLicense('any-key');
      expect(ok).toBe(false);
      expect(error.value).toContain('Network');
    });

    it('returns false when serverApiKey is missing', async () => {
      await settings.set('serverApiKey', null);
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      const { activateLicense, error } = useLicense();
      const ok = await activateLicense('key');
      expect(ok).toBe(false);
      expect(error.value).toContain('not registered');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects empty license key', async () => {
      const { activateLicense, error } = useLicense();
      const ok = await activateLicense('');
      expect(ok).toBe(false);
      expect(error.value).toContain('required');
    });

    it('trims whitespace from license key before sending', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ plan: 'pro' }), { status: 200 }),
      );
      const { activateLicense } = useLicense();
      await activateLicense('  padded-key  ');
      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
      expect(body.licenseKey).toBe('padded-key');
    });

    it('sets loading=true during activation, false after', async () => {
      let resolvePromise: (v: Response) => void;
      const pending = new Promise<Response>((r) => { resolvePromise = r; });
      vi.spyOn(globalThis, 'fetch').mockReturnValue(pending);

      const { activateLicense, loading } = useLicense();
      expect(loading.value).toBe(false);

      const activatePromise = activateLicense('key');
      expect(loading.value).toBe(true);

      resolvePromise!(new Response(JSON.stringify({ plan: 'pro' }), { status: 200 }));
      await activatePromise;
      expect(loading.value).toBe(false);
    });
  });

  describe('deactivateLicense', () => {
    it('resets plan to free and clears stored license', async () => {
      await settings.setMultiple({
        lemonSqueezyLicense: 'LS-abc',
        subscriptionStatus: 'pro',
      });

      const { plan, licenseKey, deactivateLicense, loadLicense } = useLicense();
      await loadLicense();
      expect(plan.value).toBe('pro');

      await deactivateLicense();

      expect(plan.value).toBe('free');
      expect(licenseKey.value).toBeNull();
      const stored = await settings.getWithDefaults();
      expect(stored.lemonSqueezyLicense).toBeNull();
      expect(stored.subscriptionStatus).toBe('free');
    });
  });
});
