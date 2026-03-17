import { getCollection, type CollectionEntry } from 'astro:content';

export type PublishedCollection = 'articles' | 'logs' | 'notes';
export type ArticleEntry = CollectionEntry<'articles'>;
export type LogEntry = CollectionEntry<'logs'>;
export type NoteEntry = CollectionEntry<'notes'>;

async function getPublishedEntries<T extends PublishedCollection>(collection: T) {
	const entries = await getCollection(collection, ({ data }) => !data.draft);

	return entries.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export async function getPublishedArticles() {
	return getPublishedEntries('articles');
}

export async function getPublishedLogs() {
	return getPublishedEntries('logs');
}

export async function getPublishedNotes() {
	return getPublishedEntries('notes');
}

export async function getFeaturedArticles() {
	const articles = await getPublishedArticles();

	return articles.filter((article) => article.data.featured);
}

export async function getLatestPublishedArticles(limit: number) {
	const articles = await getPublishedArticles();

	return articles.slice(0, limit);
}

export async function getLatestPublishedLogs(limit: number) {
	const logs = await getPublishedLogs();

	return logs.slice(0, limit);
}

export async function getLatestPublishedNotes(limit: number) {
	const notes = await getPublishedNotes();

	return notes.slice(0, limit);
}
