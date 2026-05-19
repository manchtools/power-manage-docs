<script lang="ts">
	import { setContext } from 'svelte';
	import * as Tabs from '$lib/components/ui/tabs';

	// {% tabs initial="apt" %}
	//   {% tab label="apt" %} ... {% /tab %}
	//   {% tab label="dnf" %} ... {% /tab %}
	// {% /tabs %}
	//
	// Markdoc-friendly authoring on top of shadcn-svelte's <Tabs>.
	// Children register themselves by label via context, the parent
	// builds the trigger row from that registry, and Tabs.Content
	// from each child renders below.
	//
	// No styling overrides — the shadcn-svelte primitive already
	// has the right look (pill-on-muted strip, raised active tab via
	// data-active:bg-background + shadow-sm). Earlier attempts to
	// "improve" the chrome broke the selected-tab affordance.

	type Props = {
		initial?: string;
		children?: import('svelte').Snippet;
	};

	const { initial, children }: Props = $props();

	type TabsCtx = {
		register: (label: string) => void;
	};

	let registered = $state<string[]>([]);
	let value = $state('');
	$effect.pre(() => {
		if (!value && initial) value = initial;
	});

	setContext<TabsCtx>('docs:tabs', {
		register(label) {
			if (registered.includes(label)) return;
			registered = [...registered, label];
			if (!value) value = label;
		}
	});
</script>

<Tabs.Root bind:value class="not-prose my-6">
	<Tabs.List>
		{#each registered as label (label)}
			<Tabs.Trigger value={label}>{label}</Tabs.Trigger>
		{/each}
	</Tabs.List>
	{@render children?.()}
</Tabs.Root>
