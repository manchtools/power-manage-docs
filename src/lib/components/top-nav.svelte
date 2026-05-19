<script lang="ts">
	import { base } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import ThemeToggle from './theme-toggle.svelte';
	import Search from './search.svelte';
	import Github from '@lucide/svelte/icons/github';

	// Top nav bar: site title + search + GitHub link + theme toggle.
	// The search trigger collapses to an icon on small screens; the
	// full input shape returns at md+.
</script>

<header
	class="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"
>
	<div class="flex h-14 items-center gap-4 px-4 lg:px-6">
		<a
			href={base + '/'}
			class="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
			aria-label="Power Manage docs home"
		>
			<span class="inline-block size-6 rounded bg-primary"></span>
			<span class="hidden sm:inline">Power Manage</span>
			<span class="hidden text-muted-foreground text-sm font-normal sm:inline">docs</span>
		</a>

		<div class="flex flex-1 justify-end md:justify-center">
			<Search />
		</div>

		<div class="flex shrink-0 items-center gap-1">
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
