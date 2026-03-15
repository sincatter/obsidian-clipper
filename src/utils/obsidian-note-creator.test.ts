import { describe, expect, it, vi } from 'vitest';
import { saveNoteToObsidianVault } from './image-downloader';

describe('obsidian note creator api writes', () => {
	it('uses PUT when saving note content through the local rest api', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			text: vi.fn().mockResolvedValue('')
		});

		vi.stubGlobal('fetch', fetchMock);

		const result = await saveNoteToObsidianVault(
			'# Title\nBody',
			'Clippings/test.md',
			{
				baseUrl: 'https://localhost:27124',
				authToken: 'secret'
			},
			'overwrite'
		);

		expect(result).toEqual({
			path: 'Clippings/test.md',
			success: true
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[0]).toBe('https://localhost:27124/vault/Clippings%2Ftest.md');
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			method: 'PUT',
			headers: {
				'Content-Type': 'text/markdown; charset=utf-8',
				'Authorization': 'Bearer secret'
			},
			body: '# Title\nBody'
		});

		vi.unstubAllGlobals();
	});
});
