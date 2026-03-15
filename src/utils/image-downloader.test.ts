import { describe, expect, it, vi } from 'vitest';
import {
	buildImageLocalPath,
	checkObsidianApiAvailable,
	filterImages,
	replaceImagesInMarkdown,
	saveImagesToObsidianVault,
	type DownloadedImage,
	type ImageExtractionResult
} from './image-downloader';
import type { ImageDownloadSettings } from '../types/types';

const settings: ImageDownloadSettings = {
	enabled: true,
	attachmentFolder: 'attachments/{note}',
	fileNameFormat: '{note}-{index}',
	maxImages: 50,
	minWidth: 100,
	minHeight: 100,
	apiBaseUrl: 'https://localhost:27124',
	apiAuthToken: 'token'
};

describe('image downloader', () => {
	it('builds a local path with resolved attachment folder placeholders', () => {
		const result = buildImageLocalPath(
			'https://example.com/path/image.png?size=large',
			settings,
			'My Note/Title',
			0,
			new Date('2026-03-15T12:00:00.000Z').valueOf()
		);

		expect(result.localPath).toBe('attachments/My NoteTitle/My NoteTitle-1.png');
		expect(result.obsidianLink).toBe('![[attachments/My NoteTitle/My NoteTitle-1.png]]');
	});

	it('keeps images with unknown dimensions instead of filtering them out', () => {
		const filtered = filterImages(
			[
				{ src: 'https://example.com/a.png' },
				{ src: 'https://example.com/b.png', width: 80, height: 120 },
				{ src: 'https://example.com/c.png', width: 120, height: 120 }
			],
			settings
		);

		expect(filtered.map(image => image.src)).toEqual([
			'https://example.com/a.png',
			'https://example.com/c.png'
		]);
	});

	it('replaces matching markdown image URLs with obsidian links', () => {
		const markdown = '![hero](https://example.com/img.png?x=1)';
		const images: DownloadedImage[] = [
			{
				originalUrl: 'https://example.com/img.png?x=1',
				localPath: 'attachments/note/img.png',
				obsidianLink: '![[attachments/note/img.png]]',
				base64Data: 'ZmFrZQ==',
				width: 100,
				height: 100,
				extension: '.png'
			}
		];

		expect(replaceImagesInMarkdown(markdown, images)).toBe('![[attachments/note/img.png]]');
	});

	it('saves images to the exact localPath used in obsidian links', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			text: vi.fn().mockResolvedValue('')
		});
		vi.stubGlobal('fetch', fetchMock);

		const images: DownloadedImage[] = [
			{
				originalUrl: 'https://example.com/img.png',
				localPath: 'attachments/note/img.png',
				obsidianLink: '![[attachments/note/img.png]]',
				base64Data: 'ZmFrZQ==',
				width: 100,
				height: 100,
				extension: '.png'
			}
		];

		const results = await saveImagesToObsidianVault(images, 'ignored-folder', {
			baseUrl: 'https://localhost:27124',
			authToken: 'secret'
		});

		expect(results).toEqual([{ path: 'attachments/note/img.png', success: true }]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[0]).toBe('https://localhost:27124/vault/attachments%2Fnote%2Fimg.png');
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			method: 'PUT',
			headers: {
				'Content-Type': 'application/octet-stream',
				'Authorization': 'Bearer secret'
			}
		});

		vi.unstubAllGlobals();
	});

	it('requires authenticated api status when an auth token is provided', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ authenticated: false })
			})
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ authenticated: true })
			});
		vi.stubGlobal('fetch', fetchMock);

		await expect(checkObsidianApiAvailable({
			baseUrl: 'https://localhost:27124',
			authToken: 'wrong-token'
		})).resolves.toBe(false);

		await expect(checkObsidianApiAvailable({
			baseUrl: 'https://localhost:27124',
			authToken: 'correct-token'
		})).resolves.toBe(true);

		vi.unstubAllGlobals();
	});
});
