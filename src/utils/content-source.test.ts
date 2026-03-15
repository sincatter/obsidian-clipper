import { describe, expect, it } from 'vitest';
import { getPreferredContentHtml } from './content-source';

describe('content source selection', () => {
	it('keeps defuddled content for non-zhihu pages', () => {
		const result = getPreferredContentHtml(
			'https://example.com/post',
			'<p>defuddled</p>',
			'<html><body><article><h1>title</h1></article></body></html>'
		);

		expect(result).toBe('<p>defuddled</p>');
	});

	it('prefers article html for zhihu pages with rich structure', () => {
		const result = getPreferredContentHtml(
			'https://zhuanlan.zhihu.com/p/1995474312946291636',
			'<p>flattened</p>',
			'<html><body><article><h1>Title</h1><pre><code>const x = 1;</code></pre><p>Body</p></article></body></html>'
		);

		expect(result).toContain('<article>');
		expect(result).toContain('<pre><code>const x = 1;</code></pre>');
	});

	it('falls back to defuddled content when zhihu article is not present', () => {
		const result = getPreferredContentHtml(
			'https://zhuanlan.zhihu.com/p/1995474312946291636',
			'<p>flattened</p>',
			'<html><body><main><p>Body</p></main></body></html>'
		);

		expect(result).toBe('<p>flattened</p>');
	});
});
