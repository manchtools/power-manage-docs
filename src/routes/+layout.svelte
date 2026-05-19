<script lang="ts">
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import TopNav from '$lib/components/top-nav.svelte';
	import Sidebar from '$lib/components/sidebar.svelte';

	type Props = { children?: import('svelte').Snippet };
	const { children }: Props = $props();
</script>

<ModeWatcher />

<div class="flex min-h-screen flex-col">
	<TopNav />

	<div class="container mx-auto flex w-full max-w-screen-2xl flex-1 px-4 lg:px-6">
		<!-- Sidebar — desktop only. A mobile drawer for the same nav
		     is a follow-up; for the initial cut the docs are
		     readable without it (top-level pages link to subsections
		     inside their content). -->
		<aside class="hidden md:block w-64 shrink-0 border-r border-border">
			<Sidebar />
		</aside>

		<!-- Main content. The [...slug] route + landing page both
		     render their content into this slot. The TOC sits inside
		     the page-specific layout because the landing page doesn't
		     have one. -->
		<main class="min-w-0 flex-1">
			{@render children?.()}
		</main>
	</div>

	<footer class="border-t border-border py-6 text-sm text-muted-foreground">
		<div class="container mx-auto max-w-screen-2xl px-4 lg:px-6">
			<p>
				Power Manage docs — built with SvelteKit + Markdoc.
				<a
					class="underline underline-offset-4 hover:text-foreground"
					href="https://github.com/manchtools/power-manage-docs"
				>
					Edit on GitHub
				</a>
			</p>
		</div>
	</footer>
</div>
