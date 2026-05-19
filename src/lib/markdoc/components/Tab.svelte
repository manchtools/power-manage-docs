<script lang="ts">
	import { getContext } from 'svelte';

	type Props = {
		label: string;
		children?: import('svelte').Snippet;
	};

	const { label, children }: Props = $props();

	type TabsCtx = {
		readonly active: string;
		register: (label: string) => void;
	};
	const ctx = getContext<TabsCtx>('docs:tabs');

	// Register on mount via $effect — runs after the parent's setContext
	// is in place. The parent renders the tab list using this
	// registration.
	$effect(() => {
		ctx.register(label);
	});
</script>

{#if ctx.active === label}
	<div role="tabpanel" class="prose-sm [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
		{@render children?.()}
	</div>
{/if}
