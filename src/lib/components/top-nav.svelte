<script lang="ts">
	import { base } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import ThemeToggle from './theme-toggle.svelte';
	import Search from './search.svelte';
	import MobileNav from './mobile-nav.svelte';
	import Github from '@lucide/svelte/icons/github';

	// Top nav bar: mobile hamburger + site title + search + GitHub +
	// theme toggle. Hamburger renders only at md:hidden; the desktop
	// sticky sidebar covers nav from md+.
</script>

<header
	class="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"
>
	<div class="flex h-14 items-center gap-2 px-4 sm:gap-4 lg:px-6">
		<MobileNav />
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
