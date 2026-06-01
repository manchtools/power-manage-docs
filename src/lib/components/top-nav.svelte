<script lang="ts">
	import { base } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import ThemeToggle from './theme-toggle.svelte';
	import Search from './search.svelte';
	import MobileNav from './mobile-nav.svelte';

	// Top nav bar: mobile hamburger + site title + search + GitHub +
	// theme toggle. Hamburger renders only at md:hidden; the desktop
	// sticky sidebar covers nav from md+.
	//
	// The GitHub mark is inlined as SVG because @lucide/svelte v1
	// dropped its github icon for trademark reasons. Keeping the
	// brand mark recognisable matters here; substituting a generic
	// 'external link' icon would dilute the affordance.
</script>

<header
	class="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"
>
	<div class="flex h-14 items-center gap-2 px-4 sm:gap-4 lg:px-6">
		<MobileNav />
		<a
			href={base + '/'}
			class="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
			aria-label="power-manage docs home"
		>
			<img
				src="{base}/favicon.svg"
				alt=""
				width="24"
				height="24"
				class="size-6 shrink-0"
			/>
			<span class="hidden sm:inline">power-manage</span>
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
				<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" class="size-4">
					<path
						d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"
					/>
				</svg>
			</Button>
			<ThemeToggle />
		</div>
	</div>
</header>
