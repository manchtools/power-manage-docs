<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { nav } from '$lib/nav';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { cn } from '$lib/utils';

	// Sidebar — left-side navigation. Groups from $lib/nav are rendered
	// in editorial order; each item is highlighted if the current
	// pathname matches. Wrapped in a ScrollArea so a long nav doesn't
	// blow out the viewport on small heights.
	//
	// Active-link matching strips the BASE_PATH prefix so deployments
	// at /docs or similar paths still highlight the right item.

	const pathname = $derived(page.url.pathname.replace(base, '') || '/');

	// Exact match only. Every nav entry is its own concrete page, so
	// there's no "parent lights up when a child is active" case to
	// support — and using a prefix match here would highlight the
	// Action-reference Overview entry whenever any /action-reference/*
	// child page was open.
	function isActive(href: string): boolean {
		return pathname === href;
	}
</script>

<ScrollArea class="h-full py-6 pr-2">
	<nav class="space-y-6 px-4 text-sm">
		{#each nav as group (group.title)}
			<div>
				<h3 class="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					{group.title}
				</h3>
				<ul class="space-y-0.5">
					{#each group.items as item (item.href)}
						<li>
							<a
								href={base + item.href}
								class={cn(
									'block rounded-md px-2 py-1.5 transition-colors',
									isActive(item.href)
										? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
										: 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
								)}
							>
								{item.label ?? item.title}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</nav>
</ScrollArea>
