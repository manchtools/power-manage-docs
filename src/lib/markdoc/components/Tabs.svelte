<script lang="ts">
	import { setContext } from 'svelte';
	import * as Tabs from '$lib/components/ui/tabs';

	// {% tabs %}
	//   {% tab label="apt" %} ... {% /tab %}
	//   {% tab label="dnf" %} ... {% /tab %}
	// {% /tabs %}
	//
	// Markdoc-friendly authoring on top of shadcn-svelte's <Tabs>.
	// Children register themselves by label via context, the parent
	// builds the trigger row from that registry, and the panels
	// (Tabs.Content from each child) render below.
	//
	// `initial` selects the open tab on mount; if not set, the first
	// registered tab wins. `default` is reserved by JS so we use
	// `initial` to avoid the destructure-rename heuristic problem in
	// svelte-markdoc-preprocess (it only picks up props whose
	// destructure name matches the type key).

	type Props = {
		initial?: string;
		children?: import('svelte').Snippet;
	};

	const { initial, children }: Props = $props();

	type TabsCtx = {
		register: (label: string) => void;
	};

	let registered = $state<string[]>([]);
	// `initial` is a one-shot default supplied via the Markdoc
	// attribute at parse time and never mutated after. Initialising
	// `value` from it inside an $effect keeps the relationship
	// readable and silences the state_referenced_locally lint that
	// flags 'capturing only the initial value of a prop'.
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
