<script lang="ts">
	// Renders markdown links. External links (anything not starting
	// with /, #, or `mailto:`) get target="_blank" + rel attributes
	// so accidental cross-origin links can't reach back to opener.
	// Internal links stay as plain <a> so SvelteKit's preload-on-hover
	// keeps working.

	type Props = {
		href: string;
		title?: string;
		children?: import('svelte').Snippet;
	};

	const { href, title, children }: Props = $props();

	const isExternal = $derived(
		!(
			href.startsWith('/') ||
			href.startsWith('#') ||
			href.startsWith('mailto:') ||
			href.startsWith('tel:')
		)
	);
</script>

{#if isExternal}
	<a {href} {title} target="_blank" rel="noopener noreferrer">{@render children?.()}</a>
{:else}
	<a {href} {title}>{@render children?.()}</a>
{/if}
