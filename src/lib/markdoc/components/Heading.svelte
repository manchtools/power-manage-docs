<script lang="ts">
	// Renders Markdoc {% heading %} (the override of the markdown
	// heading node, see markdoc/config.ts). Emits the right h1-h6
	// element with an id so the TOC sidebar can scroll to it.

	type Props = {
		level: number;
		id?: string;
		children?: import('svelte').Snippet;
	};

	const { level, id, children }: Props = $props();
</script>

{#if level === 1}
	<h1 {id}>{@render children?.()}</h1>
{:else if level === 2}
	<h2 {id}>{@render children?.()}</h2>
{:else if level === 3}
	<h3 {id}>{@render children?.()}</h3>
{:else if level === 4}
	<h4 {id}>{@render children?.()}</h4>
{:else if level === 5}
	<h5 {id}>{@render children?.()}</h5>
{:else}
	<h6 {id}>{@render children?.()}</h6>
{/if}
