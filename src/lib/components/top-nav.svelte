<script lang="ts">
	import { base } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import ThemeToggle from './theme-toggle.svelte';
	import Github from '@lucide/svelte/icons/github';

	// Top nav bar — site title + GitHub link + theme toggle. Kept
	// intentionally lean; if/when we add search and a version
	// switcher they go in this bar between the title and the
	// theme toggle.
</script>

<header
	class="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"
>
	<div class="flex h-14 items-center px-4 lg:px-6">
		<a
			href={base + '/'}
			class="flex items-center gap-2 font-semibold tracking-tight"
			aria-label="Power Manage docs home"
		>
			<span class="inline-block size-6 rounded bg-primary"></span>
			<span>Power Manage</span>
			<span class="text-muted-foreground text-sm font-normal">docs</span>
		</a>

		<div class="ml-auto flex items-center gap-1">
			<Button
				variant="ghost"
				size="icon-sm"
				href="https://github.com/manchtools/power-manage-server"
				aria-label="GitHub"
			>
				<Github class="size-4" />
			</Button>
			<ThemeToggle />
		</div>
	</div>
</header>
