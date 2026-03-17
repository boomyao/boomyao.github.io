// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: process.env.SITE_URL ?? 'https://example.com',
	base: process.env.SITE_BASE ?? '/',
	integrations: [mdx(), sitemap()],
});
