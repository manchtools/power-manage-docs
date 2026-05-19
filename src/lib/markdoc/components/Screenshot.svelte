<script lang="ts">
	import { base } from '$app/paths';

	// {% screenshot src="dashboard.png" alt="..." caption="..." dark="dashboard-dark.png" /%}
	//
	// Renders an image from /static/screenshots/ with optional
	// browser-frame chrome, a caption, and a separate dark-mode
	// variant. The <picture> + prefers-color-scheme split is a CSS
	// fallback for visitors who haven't toggled the in-app theme; the
	// in-app .dark class wins via the second source.
	//
	// Image paths are resolved against BASE_PATH so the docs work
	// when hosted under a subpath.

	type Props = {
		src: string;
		alt: string;
		dark?: string;
		caption?: string;
		// 'frame' wraps the image in a faux-browser chrome; 'flat'
		// renders just the image with a subtle border. Default is
		// 'frame' because most UI screenshots benefit from context.
		variant?: 'frame' | 'flat';
		// Optional max width override (e.g. '720px'). Default is the
		// prose column width.
		width?: string;
	};

	const {
		src,
		alt,
		dark = undefined,
		caption = undefined,
		variant = 'frame',
		width = undefined
	}: Props = $props();

	const resolve = (path: string) => `${base}/screenshots/${path.replace(/^\//, '')}`;
</script>

<figure class="not-prose my-8" style={width ? `max-width: ${width}; margin-inline: auto;` : ''}>
	{#if variant === 'frame'}
		<div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
			<!-- Faux-browser title bar. Three traffic-light dots; no
			     fake URL bar because that ages badly. -->
			<div class="flex items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-2">
				<span class="size-3 rounded-full bg-muted-foreground/30"></span>
				<span class="size-3 rounded-full bg-muted-foreground/30"></span>
				<span class="size-3 rounded-full bg-muted-foreground/30"></span>
			</div>
			<picture>
				{#if dark}
					<source srcset={resolve(dark)} media="(prefers-color-scheme: dark)" />
					<!-- The in-app .dark class flips this via CSS below -->
					<source srcset={resolve(dark)} class="dark-source" />
				{/if}
				<img {alt} src={resolve(src)} loading="lazy" class="block w-full h-auto" />
			</picture>
		</div>
	{:else}
		<div class="overflow-hidden rounded-lg border border-border">
			<picture>
				{#if dark}
					<source srcset={resolve(dark)} media="(prefers-color-scheme: dark)" />
					<source srcset={resolve(dark)} class="dark-source" />
				{/if}
				<img {alt} src={resolve(src)} loading="lazy" class="block w-full h-auto" />
			</picture>
		</div>
	{/if}
	{#if caption}
		<figcaption class="mt-3 text-center text-sm text-muted-foreground">{caption}</figcaption>
	{/if}
</figure>

<style>
	/* When the .dark class is on the document, swap to the dark
	   variant by activating its <source>. The CSS-only approach
	   keeps the SSR HTML correct for visitors without JS. */
	:global(html.dark) figure picture source.dark-source {
		display: block;
	}
</style>
