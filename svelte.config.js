import adapter from '@sveltejs/adapter-static';

const base = process.env.BASE_PATH ?? '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		paths: { base },
		prerender: {
			entries: ['*']
		}
	}
};

export default config;
