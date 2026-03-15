import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageState = {
	sync: {} as Record<string, unknown>,
	local: {} as Record<string, unknown>
};

vi.mock('core/popup', () => ({
	copyToClipboard: vi.fn()
}));

vi.mock('./browser-polyfill', () => ({
	default: {
		storage: {
			sync: {
				get: vi.fn(async (key?: string | null) => {
					if (!key) return { ...storageState.sync };
					if (typeof key === 'string') return { [key]: storageState.sync[key] };
					return { ...storageState.sync };
				}),
				set: vi.fn(async (data: Record<string, unknown>) => {
					Object.assign(storageState.sync, data);
				})
			},
			local: {
				get: vi.fn(async (key: string) => ({ [key]: storageState.local[key] })),
				set: vi.fn(async (data: Record<string, unknown>) => {
					Object.assign(storageState.local, data);
				})
			}
		}
	}
}));

describe('storage utils', () => {
	beforeEach(() => {
		storageState.sync = {};
		storageState.local = {};
		vi.stubGlobal('window', {} as Window & typeof globalThis);
		vi.resetModules();
	});

	it('loads saveSilently stats with a default of 0', async () => {
		const { loadSettings } = await import('./storage-utils');

		const settings = await loadSettings();

		expect(settings.stats.saveSilently).toBe(0);
	});

	it('increments saveSilently stats and records history entries', async () => {
		const { incrementStat, loadSettings, getClipHistory } = await import('./storage-utils');

		await incrementStat('saveSilently', 'Vault', 'Clippings', 'https://example.com', 'Example');

		const settings = await loadSettings();
		const history = await getClipHistory();

		expect(settings.stats.saveSilently).toBe(1);
		expect(history[0]).toMatchObject({
			action: 'saveSilently',
			vault: 'Vault',
			path: 'Clippings',
			url: 'https://example.com',
			title: 'Example'
		});
	});
});
