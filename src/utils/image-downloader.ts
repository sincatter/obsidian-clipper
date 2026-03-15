import browser from './browser-polyfill';
import { ImageDownloadSettings } from '../types/types';
import { extractImageExtension, sanitizeFileName } from './string-utils';
import { debugLog } from './debug';

/**
 * 图片数据接口
 */
export interface DownloadedImage {
	originalUrl: string;
	localPath: string;
	obsidianLink: string;
	base64Data?: string;
	width: number;
	height: number;
	extension: string;
}

export interface ImageExtractionResult {
	images: DownloadedImage[];
	errors: ImageError[];
}

export interface ImageError {
	url: string;
	error: string;
}

interface ImageInfo {
	src: string;
	srcset?: string;
	alt?: string;
	width?: number;
	height?: number;
	naturalWidth?: number;
	naturalHeight?: number;
}

function sanitizePathSegment(segment: string): string {
	const sanitized = sanitizeFileName(segment).replace(/[\\/]+/g, '').trim();
	return sanitized || 'Untitled';
}

function normalizeAttachmentFolder(folder: string, noteName: string, timestamp: number): string {
	const resolvedFolder = (folder || 'attachments')
		.replace(/{note}/g, sanitizePathSegment(noteName))
		.replace(/{date}/g, new Date(timestamp).toISOString().split('T')[0])
		.replace(/{timestamp}/g, String(timestamp));

	const segments = resolvedFolder
		.split('/')
		.map(segment => segment.trim())
		.filter(Boolean)
		.map(sanitizePathSegment);

	return segments.join('/') || 'attachments';
}

export function buildImageLocalPath(
	sourceUrl: string,
	settings: ImageDownloadSettings,
	noteName: string,
	index: number,
	timestamp: number = Date.now()
): { localPath: string; extension: string; obsidianLink: string } {
	const extension = extractImageExtension(sourceUrl);
	const fileName = formatImageFileName(settings.fileNameFormat, noteName, index, timestamp, extension);
	const attachmentFolder = normalizeAttachmentFolder(settings.attachmentFolder || 'attachments', noteName, timestamp);
	const localPath = `${attachmentFolder}/${fileName}`;

	return {
		localPath,
		extension,
		obsidianLink: `![[${localPath}]]`
	};
}

/**
 * 从 HTML 内容提取所有图片
 */
export function extractImagesFromHtml(html: string, baseUrl: string): ImageInfo[] {
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, 'text/html');
	const images: ImageInfo[] = [];

	// 查找所有 img 元素
	const imgElements = doc.querySelectorAll('img');

	imgElements.forEach(img => {
		const src = img.getAttribute('src');
		const srcset = img.getAttribute('srcset');
		const alt = img.getAttribute('alt') || '';
		const width = img.getAttribute('width');
		const height = img.getAttribute('height');

		if (src && !isExcludedImage(src)) {
			// 解析相对 URL
			const absoluteSrc = resolveUrl(src, baseUrl);

			images.push({
				src: absoluteSrc,
				srcset: srcset ? resolveUrl(srcset, baseUrl) : undefined,
				alt,
				width: width ? parseInt(width, 10) : undefined,
				height: height ? parseInt(height, 10) : undefined
			});
		}
	});

	debugLog('ImageDownload', `从 HTML 中提取了 ${images.length} 张图片`);
	return images;
}

/**
 * 根据设置过滤图片
 */
export function filterImages(images: ImageInfo[], settings: ImageDownloadSettings): ImageInfo[] {
	let filtered = images;

	// 根据最小尺寸过滤
	if (settings.minWidth || settings.minHeight) {
		filtered = filtered.filter(img => {
			const width = img.width || img.naturalWidth;
			const height = img.height || img.naturalHeight;

			if (settings.minWidth && width !== undefined && width < settings.minWidth) {
				return false;
			}
			if (settings.minHeight && height !== undefined && height < settings.minHeight) {
				return false;
			}
			return true;
		});
	}

	debugLog('ImageDownload', `尺寸过滤后剩余 ${filtered.length} 张图片`);

	// 限制图片数量
	if (settings.maxImages && filtered.length > settings.maxImages) {
		filtered = filtered.slice(0, settings.maxImages);
		debugLog('ImageDownload', `限制为 ${settings.maxImages} 张图片`);
	}

	return filtered;
}

/**
 * 下载单个图片并转换为 base64
 */
export async function downloadImage(
	url: string,
	index: number,
	settings: ImageDownloadSettings,
	noteName: string
): Promise<DownloadedImage> {
	const timestamp = Date.now();
	const { localPath, extension, obsidianLink } = buildImageLocalPath(url, settings, noteName, index, timestamp);

	debugLog('ImageDownload', `下载图片 ${index}: ${url}`);

	try {
		// 获取图片
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'Accept': 'image/*'
			}
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		// 获取 blob
		const blob = await response.blob();

		// 转换为 base64
		const base64Data = await blobToBase64(blob);

		const imageInfo: DownloadedImage = {
			originalUrl: url,
			localPath: localPath,
			obsidianLink: obsidianLink,
			base64Data: base64Data,
			width: 0,
			height: 0,
			extension: extension
		};

		return imageInfo;
	} catch (error) {
		debugLog('ImageDownload', `下载图片失败：${url}`, error);
		throw error;
	}
}

/**
 * 将 Blob 转换为 Base64
 */
function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			const result = reader.result as string;
			// 移除 data:image/png;base64, 前缀
			const base64 = result.split(',')[1] || result;
			resolve(base64);
		};
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

/**
 * 并发下载多张图片
 */
export async function downloadImages(
	images: ImageInfo[],
	settings: ImageDownloadSettings,
	noteName: string,
	concurrency: number = 5
): Promise<ImageExtractionResult> {
	const downloadedImages: DownloadedImage[] = [];
	const errors: ImageError[] = [];

	// 分批处理图片
	const batches: ImageInfo[][] = [];
	for (let i = 0; i < images.length; i += concurrency) {
		batches.push(images.slice(i, i + concurrency));
	}

	for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
		const batch = batches[batchIndex];
		debugLog('ImageDownload', `处理批次 ${batchIndex + 1}/${batches.length}`);

		const results = await Promise.allSettled(
			batch.map((img, index) => {
				const globalIndex = batchIndex * concurrency + index;
				return downloadImage(img.src, globalIndex, settings, noteName);
			})
		);

		results.forEach((result, index) => {
			const globalIndex = batchIndex * concurrency + index;
			const url = images[globalIndex]?.src;

			if (result.status === 'fulfilled') {
				downloadedImages.push(result.value);
			} else {
				errors.push({
					url: url || 'unknown',
					error: result.reason?.message || '未知错误'
				});
			}
		});

		// 批次间小延迟，避免压垮服务器
		if (batchIndex < batches.length - 1) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}

	debugLog('ImageDownload', `成功下载 ${downloadedImages.length} 张图片，${errors.length} 个错误`);

	return {
		images: downloadedImages,
		errors
	};
}

/**
 * 在 Markdown 中将远程图片链接替换为 Obsidian 本地链接
 * 将 ![](https://example.com/image.png) 替换为 ![[attachments/image.png]]
 */
export function replaceImagesInMarkdown(
	markdown: string,
	images: DownloadedImage[]
): string {
	let result = markdown;

	debugLog('ImageDownload', '开始替换 Markdown 中的图片');
	debugLog('ImageDownload', `Markdown 长度：${markdown.length}`);
	debugLog('ImageDownload', `下载的图片数量：${images.length}`);

	// 创建原始 URL 到下载图片的映射
	const urlMap = new Map<string, DownloadedImage>();
	images.forEach(img => {
		urlMap.set(img.originalUrl, img);
		// 同时添加不带查询参数的版本用于匹配
		const cleanUrl = img.originalUrl.split('?')[0];
		urlMap.set(cleanUrl, img);
		// 也添加部分 URL（不带协议）用于匹配
		const noProtocolUrl = img.originalUrl.replace(/^https?:\/\//, '');
		urlMap.set(noProtocolUrl, img);
	});

	debugLog('ImageDownload', `URL 映射大小：${urlMap.size}`);

	// 匹配 Markdown 图片语法：![alt](url) 或 ![](url)
	// Defuddle 可能输出不同格式，需要更宽松的匹配
	const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;

	let matchCount = 0;
	let replaceCount = 0;
	result = result.replace(markdownImageRegex, (match, alt, url) => {
		matchCount++;
		// 尝试多种 URL 匹配方式
		const cleanUrl = url.split('?')[0];
		const decodedUrl = decodeURIComponent(cleanUrl);
		const noProtocolUrl = url.replace(/^https?:\/\//, '');
		const cleanNoProtocolUrl = noProtocolUrl.split('?')[0];

		// 按优先级尝试匹配
		let downloadedImg = urlMap.get(url) ||
		                    urlMap.get(cleanUrl) ||
		                    urlMap.get(decodedUrl) ||
		                    urlMap.get(noProtocolUrl) ||
		                    urlMap.get(cleanNoProtocolUrl);

		if (downloadedImg) {
			replaceCount++;
			debugLog('ImageDownload', `替换图片：${url} -> ${downloadedImg.obsidianLink}`);
			return downloadedImg.obsidianLink;
		}
		debugLog('ImageDownload', `未找到匹配的图片：${url}`);
		return match; // 如果没有找到下载的图片，保留原始链接
	});

	debugLog('ImageDownload', `Markdown 中找到 ${matchCount} 个图片，成功替换 ${replaceCount} 个`);

	// 输出 Markdown 前 1000 个字符用于调试
	debugLog('ImageDownload', `Markdown 内容预览：${result.substring(0, 1000)}`);

	return result;
}

/**
 * 在 HTML 中将图片标签替换为 Obsidian 风格链接
 */
export function replaceImagesInHtml(
	html: string,
	images: DownloadedImage[]
): string {
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, 'text/html');

	// 创建原始 URL 到下载图片的映射
	const urlMap = new Map<string, DownloadedImage>();
	images.forEach(img => {
		urlMap.set(img.originalUrl, img);
		// 同时添加不带查询参数的版本用于匹配
		const cleanUrl = img.originalUrl.split('?')[0];
		urlMap.set(cleanUrl, img);
	});

	// 查找所有 img 元素并替换
	const imgElements = Array.from(doc.querySelectorAll('img'));

	imgElements.forEach(img => {
		const src = img.getAttribute('src');
		if (src) {
			const cleanSrc = src.split('?')[0];
			const downloadedImg = urlMap.get(src) || urlMap.get(cleanSrc);

			if (downloadedImg) {
				// 将 img 标签替换为包含 Obsidian 链接的文本节点
				const obsidianLink = document.createTextNode(downloadedImg.obsidianLink);
				const parent = img.parentNode;
				if (parent) {
					const parentElement = parent as Element;
					if (parentElement.tagName?.toLowerCase() === 'picture') {
						// 替换整个 picture 元素
						parent.parentNode?.replaceChild(obsidianLink, parent);
					} else if (parentElement.tagName?.toLowerCase() === 'figure') {
						// 只替换 img，保留 figcaption
						img.replaceWith(obsidianLink);
					} else {
						// 简单替换
						img.replaceWith(obsidianLink);
					}
				}
			}
		}
	});

	// 序列化为 HTML
	const serializer = new XMLSerializer();
	let result = '';
	Array.from(doc.body.childNodes).forEach(node => {
		if (node.nodeType === Node.ELEMENT_NODE) {
			result += serializer.serializeToString(node);
		} else if (node.nodeType === Node.TEXT_NODE) {
			result += node.textContent;
		}
	});

	return result;
}

/**
 * 检查图片是否应该被排除
 */
function isExcludedImage(src: string): boolean {
	// 排除 data URI（base64 内联图片）
	if (src.startsWith('data:')) {
		return true;
	}

	// 排除 SVG 图标
	if (src.includes('icon') || src.includes('logo') || src.includes('pixel')) {
		return true;
	}

	// 排除非常小的图片 URL（可能是追踪像素）
	if (src.includes('1x1') || src.includes('pixel')) {
		return true;
	}

	return false;
}

/**
 * 解析相对于 baseURL 的 URL
 */
function resolveUrl(url: string, baseUrl: string): string {
	// 处理 srcset 可能包含多个 URL
	if (url.includes(',')) {
		return url.split(',').map(u => {
			const parts = u.trim().split(/\s+/);
			if (parts.length >= 1) {
				const resolved = resolveSingleUrl(parts[0], baseUrl);
				return parts.length > 1 ? `${resolved} ${parts.slice(1).join(' ')}` : resolved;
			}
			return u;
		}).join(', ');
	}

	return resolveSingleUrl(url, baseUrl);
}

function resolveSingleUrl(url: string, baseUrl: string): string {
	try {
		// 处理协议相对 URL
		if (url.startsWith('//')) {
			const baseProtocol = baseUrl.split('://')[0] || 'https';
			return `${baseProtocol}:${url}`;
		}

		// 处理绝对 URL
		if (url.startsWith('http://') || url.startsWith('https://')) {
			return url;
		}

		// 处理相对 URL
		const base = new URL(baseUrl);
		if (url.startsWith('/')) {
			return `${base.protocol}//${base.host}${url}`;
		}

		// 处理相对路径
		const path = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
		return `${base.protocol}//${base.host}${path}${url}`;
	} catch (error) {
		debugLog('ImageDownload', `解析 URL 失败：${url}`, error);
		return url;
	}
}

/**
 * 根据设置格式化图片文件名
 */
function formatImageFileName(
	format: string,
	noteName: string,
	index: number,
	timestamp: number,
	extension: string
): string {
	// 如果存在则移除扩展名
	const baseFormat = format.replace(/\.(png|jpg|jpeg|gif|webp|svg|bmp|avif)$/i, '');

	// 替换占位符
	let fileName = baseFormat
		.replace(/{note}/g, sanitizePathSegment(noteName))
		.replace(/{index}/g, String(index + 1))
		.replace(/{timestamp}/g, String(timestamp))
		.replace(/{date}/g, new Date(timestamp).toISOString().split('T')[0]);

	// 如果格式结果为空，使用默认值
	if (!fileName.trim()) {
		fileName = `${noteName}-${index + 1}`;
	}

	fileName = sanitizePathSegment(fileName);

	// 添加扩展名
	return `${fileName}${extension}`;
}

/**
 * 获取默认图片下载设置
 */
export function getDefaultImageDownloadSettings(): ImageDownloadSettings {
	return {
		enabled: false,
		attachmentFolder: 'attachments',
		fileNameFormat: '{note}-{index}',
		maxImages: 50,
		minWidth: 10,
		minHeight: 10,
		apiBaseUrl: 'https://localhost:27124',
		apiAuthToken: ''
	};
}

/**
 * 生成用于 Obsidian 插件 API 的图片数据包
 * 这个数据包可以通过消息传递给 Obsidian 插件
 */
export function createImagePayload(images: DownloadedImage[]): ImagePayload {
	return {
		action: 'saveImages',
		images: images.map(img => ({
			path: img.localPath,
			base64Data: img.base64Data!
		})),
		timestamp: Date.now()
	};
}

export interface ImagePayload {
	action: 'saveImages';
	images: Array<{
		path: string;
		base64Data: string;
	}>;
	timestamp: number;
}

/**
 * 通过 obsidian-local-rest-api 将图片保存到 Obsidian vault
 * API 文档：https://github.com/coddingtonbear/obsidian-local-rest-api
 */
export async function saveImagesToObsidianVault(
	images: DownloadedImage[],
	_attachmentFolder: string,
	apiConfig: ApiConfig
): Promise<SaveImageResult[]> {
	const results: SaveImageResult[] = [];
	const baseUrl = apiConfig.baseUrl;

	for (const img of images) {
		try {
			// 将 base64 转换为 Blob
			const blob = base64ToBlob(img.base64Data!, img.extension);

			// 转换为 ArrayBuffer
			const arrayBuffer = await blob.arrayBuffer();

			const filePath = img.localPath;

			// 调用 obsidian-local-rest-api
			const response = await fetch(`${baseUrl}/vault/${encodeURIComponent(filePath)}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/octet-stream',
					...(apiConfig.authToken ? { 'Authorization': `Bearer ${apiConfig.authToken}` } : {})
				},
				body: arrayBuffer
			});

			if (response.ok) {
				results.push({
					path: filePath,
					success: true
				});
				debugLog('ImageDownload', `已保存图片：${filePath}`);
			} else {
				const errorText = await response.text();
				results.push({
					path: filePath,
					success: false,
					error: `HTTP ${response.status}: ${errorText}`
				});
				console.error(`保存图片失败 ${filePath}:`, errorText);
			}
		} catch (error) {
			results.push({
				path: img.localPath,
				success: false,
				error: error instanceof Error ? error.message : '未知错误'
			});
			console.error(`保存图片失败 ${img.localPath}:`, error);
		}
	}

	return results;
}

export interface SaveImageResult {
	path: string;
	success: boolean;
	error?: string;
}

export interface ApiConfig {
	baseUrl: string;
	authToken?: string;
}

interface ApiStatusResponse {
	authenticated?: boolean;
}

async function fetchObsidianApiStatus(apiConfig?: ApiConfig): Promise<{ ok: boolean; authenticated: boolean }> {
	const baseUrl = apiConfig?.baseUrl || 'https://localhost:27124';
	const response = await fetch(baseUrl, {
		method: 'GET',
		signal: AbortSignal.timeout(2000),
		...(apiConfig?.authToken ? { headers: { 'Authorization': `Bearer ${apiConfig.authToken}` } } : {})
	});

	if (!response.ok) {
		return { ok: false, authenticated: false };
	}

	let authenticated = false;
	try {
		const payload = await response.json() as ApiStatusResponse;
		authenticated = payload.authenticated === true;
	} catch (error) {
		debugLog('ImageDownload', 'Failed to parse API status payload', error);
	}

	return { ok: true, authenticated };
}

/**
 * 检查 obsidian-local-rest-api 是否可用
 */
export async function checkObsidianApiAvailable(apiConfig?: ApiConfig): Promise<boolean> {
	try {
		const status = await fetchObsidianApiStatus(apiConfig);
		if (!status.ok) {
			return false;
		}

		if (apiConfig?.authToken) {
			return status.authenticated;
		}

		return true;
	} catch (error) {
		return false;
	}
}

/**
 * 将 Base64 转换为 Blob
 */
function base64ToBlob(base64: string, extension: string): Blob {
	const byteCharacters = atob(base64);
	const byteNumbers = new Array(byteCharacters.length);

	for (let i = 0; i < byteCharacters.length; i++) {
		byteNumbers[i] = byteCharacters.charCodeAt(i);
	}

	const byteArray = new Uint8Array(byteNumbers);
	return new Blob([byteArray], { type: getMimeType(extension) });
}

/**
 * 通过 obsidian-local-rest-api 将笔记保存到 Obsidian vault
 * API 文档：https://github.com/coddingtonbear/obsidian-local-rest-api
 */
export async function saveNoteToObsidianVault(
	fileContent: string,
	filePath: string,
	apiConfig: ApiConfig,
	behavior?: 'append' | 'prepend' | 'overwrite'
): Promise<SaveNoteResult> {
	try {
		// 构建完整的 API URL
		const url = `${apiConfig.baseUrl}/vault/${encodeURIComponent(filePath)}`;

		// 构建请求选项
		const options: RequestInit = {
			method: 'PUT',
			headers: {
				'Content-Type': 'text/markdown; charset=utf-8',
				...(apiConfig.authToken ? { 'Authorization': `Bearer ${apiConfig.authToken}` } : {})
			},
			body: fileContent
		};

		// 如果是追加或前置模式，需要先读取现有内容
		if (behavior === 'append' || behavior === 'prepend') {
			// 先尝试读取现有文件
			const readResponse = await fetch(url, {
				method: 'GET',
				headers: {
					...(apiConfig.authToken ? { 'Authorization': `Bearer ${apiConfig.authToken}` } : {})
				}
			});

			if (readResponse.ok) {
				const existingContent = await readResponse.text();
				if (behavior === 'append') {
					fileContent = existingContent + '\n' + fileContent;
				} else {
					fileContent = fileContent + '\n' + existingContent;
				}
				options.body = fileContent;
			}
		}

		// 保存文件
		const response = await fetch(url, options);

		if (response.ok) {
			console.log('已保存笔记到 Obsidian vault:', filePath);
			return {
				path: filePath,
				success: true
			};
		} else {
			const errorText = await response.text();
			console.error(`保存笔记失败 ${filePath}:`, errorText);
			return {
				path: filePath,
				success: false,
				error: `HTTP ${response.status}: ${errorText}`
			};
		}
	} catch (error) {
		console.error(`保存笔记失败 ${filePath}:`, error);
		return {
			path: filePath,
			success: false,
			error: error instanceof Error ? error.message : '未知错误'
		};
	}
}

export interface SaveNoteResult {
	path: string;
	success: boolean;
	error?: string;
}

/**
 * 获取文件扩展名对应的 MIME 类型
 */
function getMimeType(extension: string): string {
	const mimeTypes: { [key: string]: string } = {
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.gif': 'image/gif',
		'.webp': 'image/webp',
		'.svg': 'image/svg+xml',
		'.bmp': 'image/bmp',
		'.avif': 'image/avif'
	};
	return mimeTypes[extension] || 'application/octet-stream';
}
