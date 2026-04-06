import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const articles = defineCollection({
	loader: glob({ base: './src/content/articles', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			draft: z.boolean().default(false),
			featured: z.boolean().default(false),
			tags: z.array(z.string()).default([]),
			heroImage: z.optional(image()),
		}),
});

const logs = defineCollection({
	loader: glob({ base: './src/content/logs', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			draft: z.boolean().default(false),
			featured: z.boolean().default(false),
			tags: z.array(z.string()).default([]),
			heroImage: z.optional(image()),
		}),
});

const notes = defineCollection({
	loader: glob({ base: './src/content/notes', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			draft: z.boolean().default(false),
			featured: z.boolean().default(false),
			tags: z.array(z.string()).default([]),
			heroImage: z.optional(image()),
		}),
});

const showcases = defineCollection({
	loader: glob({ base: './src/content/showcases', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			pubDate: z.coerce.date(),
			draft: z.boolean().default(false),
			tags: z.array(z.string()).default([]),
			url: z.string(),
			cover: z.optional(image()),
		}),
});

export const collections = { articles, logs, notes, showcases };
