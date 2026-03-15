function isZhihuArticleUrl(pageUrl: string): boolean {
	try {
		const url = new URL(pageUrl);
		return url.hostname === 'zhuanlan.zhihu.com' || (url.hostname.endsWith('.zhihu.com') && url.pathname.startsWith('/p/'));
	} catch (error) {
		return false;
	}
}

export function getPreferredContentHtml(
	pageUrl: string,
	defuddledContent: string,
	cleanedHtml: string
): string {
	if (!isZhihuArticleUrl(pageUrl)) {
		return defuddledContent;
	}

	const articleMatch = cleanedHtml.match(/<article\b[^>]*>[\s\S]*?<\/article>/i);
	const articleHtml = articleMatch?.[0];

	if (articleHtml && /<(pre|code|table|blockquote|ul|ol|h1|h2|h3|h4|h5|h6|figure)\b/i.test(articleHtml)) {
		return articleHtml;
	}

	return defuddledContent;
}
