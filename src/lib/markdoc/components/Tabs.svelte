<script lang="ts">
	import { cn } from '$lib/utils';
	import { setContext } from 'svelte';

	// {% tabs %}
	//   {% tab label="apt" %} ... {% /tab %}
	//   {% tab label="dnf" %} ... {% /tab %}
	// {% /tabs %}
	//
	// Tabs auto-discover their children by name via context — no
	// need for the author to list labels on the parent. An
	// `initial` attribute on {% tabs %} selects the initially-open
	// tab; without it the first child wins.
	//
	// (Why not `default`? svelte-markdoc-preprocess introspects the
	// $props() destructure for attribute names, and JS reserves
	// `default` as a destructuring rename target, so we'd have to
	// alias to `{ default: foo }` — which the preprocessor's
	// key===value heuristic doesn't pick up. `initial` is plain.)

	type Props = {
		initial?: string;
		children?: import('svelte').Snippet;
	};

	const { initial, children }: Props = $props();

	type TabsCtx = {
		registered: { label: string }[];
		active: string;
		register: (label: string) => void;
		select: (label: string) => void;
	};

	let registered = $state<{ label: string }[]>([]);
	// `initial` is a one-shot default — it's set by the Markdoc {%
	// tabs default="…" %} attribute once at parse time and never
	// changes after mount. Capturing only its initial value (and
	// not tracking subsequent assignments) is intentional; the
	// untrack() makes the intent explicit so svelte-check doesn't
	// warn about state_referenced_locally.
	let active = $state<string>('');
	$effect.pre(() => {
		if (!active && initial) active = initial;
	});

	const ctx: TabsCtx = {
		get registered() {
			return registered;
		},
		get active() {
			return active;
		},
		register(label) {
			if (registered.find((t) => t.label === label)) return;
			registered = [...registered, { label }];
			if (!active) active = label;
		},
		select(label) {
			active = label;
		}
	};

	setContext('docs:tabs', ctx);
</script>

<div class="not-prose my-6 overflow-hidden rounded-lg border border-border">
	<!-- Tab list. Renders after children mount via context — this
	     means the list is one render late on the very first paint;
	     acceptable trade-off vs forcing authors to pre-declare labels. -->
	<div role="tablist" class="flex border-b border-border bg-muted/40">
		{#each registered as t (t.label)}
			<button
				type="button"
				role="tab"
				aria-selected={active === t.label}
				class={cn(
					'px-4 py-2 text-sm font-medium transition-colors',
					active === t.label
						? 'bg-background text-foreground'
						: 'text-muted-foreground hover:text-foreground'
				)}
				onclick={() => ctx.select(t.label)}
			>
				{t.label}
			</button>
		{/each}
	</div>
	<div class="p-4">{@render children?.()}</div>
</div>
