<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { cn } from '$lib/utils';

	// Right-side "On this page" TOC. Auto-built from the rendered DOM
	// rather than from frontmatter — that means the TOC always
	// matches what's actually on the page even if the author forgets
	// to update a separate index. Re-built on every navigation.
	//
	// Active-heading detection uses IntersectionObserver: whatever
	// heading is closest to the top of the viewport gets the
	// "current" highlight. A 25% rootMargin from the top makes the
	// switch feel right for normal scrolling.

	type Heading = { id: string; text: string; level: number };

	let headings = $state<Heading[]>([]);
	let activeId = $state<string | null>(null);
	let observer: IntersectionObserver | null = null;

	function collect() {
		const selectors = 'main h2[id], main h3[id]';
		const els = Array.from(document.querySelectorAll<HTMLElement>(selectors));
		headings = els.map((el) => ({
			id: el.id,
			text: el.textContent ?? '',
			level: Number(el.tagName.slice(1))
		}));
		// (Re)wire the observer
		observer?.disconnect();
		observer = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) {
						activeId = (e.target as HTMLElement).id;
						break;
					}
				}
			},
			{ rootMargin: '0px 0px -75% 0px', threshold: 0 }
		);
		for (const el of els) observer.observe(el);
		if (!activeId && els.length) activeId = els[0].id;
	}

	onMount(() => {
		collect();
	});

	// Re-collect headings after every successful navigation. page.url
	// changes synchronously when the new route mounts; we wait a tick
	// for the markdoc-rendered content to be in the DOM.
	$effect(() => {
		void page.url.pathname;
		queueMicrotask(collect);
	});

	onDestroy(() => observer?.disconnect());
</script>

{#if headings.length > 1}
	<aside class="hidden xl:block w-56 shrink-0 py-6">
		<div class="sticky top-6 max-h-[calc(100%-3rem)] overflow-auto pr-2 text-sm">
			<p class="mb-2 font-semibold text-foreground/90">On this page</p>
			<ul class="space-y-1 border-l border-border">
				{#each headings as h (h.id)}
					<li>
						<a
							href={'#' + h.id}
							class={cn(
								'block py-1 pl-3 -ml-px border-l transition-colors',
								h.level > 2 && 'pl-6',
								activeId === h.id
									? 'border-foreground text-foreground font-medium'
									: 'border-transparent text-muted-foreground hover:text-foreground'
							)}
						>
							{h.text}
						</a>
					</li>
				{/each}
			</ul>
		</div>
	</aside>
{/if}
