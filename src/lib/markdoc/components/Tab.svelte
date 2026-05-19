<script lang="ts">
	import { getContext } from 'svelte';
	import * as Tabs from '$lib/components/ui/tabs';

	// Single tab panel inside a {% tabs %} block. Registers its label
	// with the parent via context so the parent can render a trigger
	// for it, then mounts a Tabs.Content keyed by the same label —
	// shadcn-svelte's Tabs.Root handles which panel is visible.

	type Props = {
		label: string;
		children?: import('svelte').Snippet;
	};

	const { label, children }: Props = $props();

	type TabsCtx = {
		register: (label: string) => void;
	};
	const ctx = getContext<TabsCtx>('docs:tabs');

	$effect(() => {
		ctx.register(label);
	});
</script>

<Tabs.Content value={label} class="prose-sm [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
	{@render children?.()}
</Tabs.Content>
