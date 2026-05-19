<script lang="ts">
	import { base } from '$app/paths';
	import { flatNav } from '$lib/nav';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	// Previous / next page links at the bottom of each docs page.
	// The nav order in $lib/nav.ts is the source of truth; this
	// component finds the current page by href and surfaces the
	// neighbours.
	//
	// If the current path isn't in the nav list (e.g. a draft page
	// the author hasn't wired up yet), both prev and next are
	// undefined and the component renders nothing rather than showing
	// confusing links to unrelated pages.

	type Props = {
		currentHref: string;
	};

	const { currentHref }: Props = $props();

	const idx = $derived(flatNav.findIndex((it) => it.href === currentHref));
	const prev = $derived(idx > 0 ? flatNav[idx - 1] : undefined);
	const next = $derived(idx >= 0 && idx < flatNav.length - 1 ? flatNav[idx + 1] : undefined);
</script>

{#if prev || next}
	<nav
		class="not-prose mt-12 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:justify-between"
		aria-label="Previous / next page"
	>
		{#if prev}
			<a
				href={base + prev.href}
				class="group flex flex-1 items-center gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-accent/40"
			>
				<ChevronLeft class="size-5 text-muted-foreground transition-transform group-hover:-translate-x-0.5" />
				<div class="flex flex-col">
					<span class="text-xs uppercase tracking-wide text-muted-foreground">Previous</span>
					<span class="font-medium">{prev.title}</span>
				</div>
			</a>
		{:else}
			<div class="flex-1"></div>
		{/if}

		{#if next}
			<a
				href={base + next.href}
				class="group flex flex-1 items-center justify-end gap-3 rounded-lg border border-border p-4 text-right transition-colors hover:bg-accent/40"
			>
				<div class="flex flex-col">
					<span class="text-xs uppercase tracking-wide text-muted-foreground">Next</span>
					<span class="font-medium">{next.title}</span>
				</div>
				<ChevronRight class="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
			</a>
		{:else}
			<div class="flex-1"></div>
		{/if}
	</nav>
{/if}
