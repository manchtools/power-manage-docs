<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Sidebar from './sidebar.svelte';
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';
	import { cn } from '$lib/utils';

	// Mobile hamburger + drawer. Visible only at md:hidden; the
	// desktop sticky sidebar covers everything from md+ already.
	//
	// Reuses <Sidebar /> so there's a single source of truth for
	// nav structure. The Sidebar component already has its own
	// ScrollArea sized to viewport-minus-topnav, which is exactly
	// the space the drawer body offers, so it just slots in.

	let open = $state(false);

	// Close on every successful navigation, so tapping a nav link
	// drops the drawer rather than leaving it covering the page.
	afterNavigate(() => {
		open = false;
	});

	function onKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			event.preventDefault();
			open = false;
		}
	}
</script>

<svelte:window on:keydown={onKeydown} />

<button
	type="button"
	onclick={() => (open = true)}
	aria-label="Open navigation menu"
	aria-expanded={open}
	class={cn(
		'inline-flex size-9 items-center justify-center rounded-md',
		'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
		'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
		'md:hidden'
	)}
>
	<Menu class="size-5" />
</button>

{#if open}
	<div
		role="presentation"
		onclick={() => (open = false)}
		class="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
		transition:fade={{ duration: 120 }}
	></div>
	<div
		role="dialog"
		aria-modal="true"
		aria-label="Navigation menu"
		class="fixed left-0 top-0 z-50 flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-background shadow-xl md:hidden"
		transition:fly={{ x: -288, duration: 200, easing: cubicOut, opacity: 1 }}
	>
		<!-- Header mirrors the top-nav height so the drawer reads as
		     a panel that slid out from underneath it. -->
		<div class="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
			<span class="font-semibold tracking-tight">Menu</span>
			<button
				type="button"
				onclick={() => (open = false)}
				aria-label="Close navigation menu"
				class="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				<X class="size-5" />
			</button>
		</div>
		<Sidebar />
	</div>
{/if}
