import rss from '@astrojs/rss';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';
import { getPublishedArticles } from '../lib/content';

export async function GET(context) {
	const articles = await getPublishedArticles();
	const items = articles
		.map((article) => ({
			title: article.data.title,
			description: article.data.description,
			pubDate: article.data.pubDate,
			link: `/blog/articles/${article.id}/`,
		}))
		.sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf());

	return rss({
		title: `${SITE_TITLE} | 文章 RSS`,
		description: `${SITE_DESCRIPTION}（文章栏目）`,
		site: context.site,
		items,
	});
}
