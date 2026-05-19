<script lang="ts">
	import { onMount } from 'svelte';
	import { mode } from 'mode-watcher';
	import { Button } from '$lib/components/ui/button';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import { cn } from '$lib/utils';

	// Fenced code block. Two branches:
	//
	//   - language === 'mermaid' renders as a diagram via mermaid.js.
	//     Dynamic-imported on first paint so the ~500KB bundle never
	//     ships on pages without diagrams. Re-renders when the colour
	//     mode flips so light/dark stays correct.
	//
	//   - everything else gets Shiki-highlighted. Picks a single theme
	//     (github-light or github-dark) based on mode.current at
	//     render time, so the inline `color:` and `background-color:`
	//     Shiki emits on each span just work without any CSS-variable
	//     juggling. Re-renders on mode flip the same way Mermaid does.

	type Props = {
		content: string;
		language?: string;
	};

	const { content, language = 'text' }: Props = $props();

	const isMermaid = $derived(language === 'mermaid');

	let highlighted = $state<string | null>(null);
	let mermaidSvg = $state<string | null>(null);
	let mermaidError = $state<string | null>(null);
	let copied = $state(false);

	// Stable id per mounted component so mermaid.render's internal
	// xlink:href targets don't collide when a page has more than one
	// diagram. crypto.randomUUID isn't available SSR-side, so keep
	// this client-only by deriving inside an effect.
	let diagramId = $state('mermaid-pending');

	onMount(() => {
		if (isMermaid) {
			diagramId = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
		}
	});

	// Highlight in a theme-reactive effect. Reading mode.current makes
	// the effect re-run on every light/dark flip, so Shiki re-renders
	// the code with the matching theme. Single-theme output means
	// Shiki sets inline `color:` and `background-color:` directly on
	// each span/pre — no CSS-variable indirection, no override risk
	// from the typography plugin's .prose pre defaults.
	$effect(() => {
		if (isMermaid) return;
		const theme = mode.current === 'dark' ? 'github-dark' : 'github-light';
		void (async () => {
			try {
				const { codeToHtml } = await import('shiki');
				highlighted = await codeToHtml(content.trimEnd(), {
					lang: language,
					theme
				});
			} catch (err) {
				console.warn('[CodeBlock] highlight failed', { language, err });
			}
		})();
	});

	// oklch() → sRGB conversion. Per CSS Color 4, modern browsers
	// preserve wide-gamut colours through both canvas2d.fillStyle
	// and CSSOM.color to avoid lossy down-conversion — which means
	// neither of the obvious round-trip tricks actually flattens
	// oklch into rgb. So we do the math directly:
	//   OKLch → OKLab → LMS → linear sRGB → gamma-corrected sRGB.
	// Refs: https://bottosson.github.io/posts/oklab/ +
	// the CSS Color 4 spec matrices.
	function oklchToRgb(value: string): string {
		const m = value.match(
			/oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i
		);
		if (!m) return value;
		const pct = (s: string, scale = 1) =>
			s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s) * scale;
		const L = pct(m[1]);
		const C = pct(m[2], m[2].endsWith('%') ? 0.4 : 1); // 100% chroma = 0.4 per spec
		const H = (parseFloat(m[3]) * Math.PI) / 180;
		const A = m[4] ? pct(m[4]) : 1;

		const a = C * Math.cos(H);
		const b = C * Math.sin(H);

		const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
		const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
		const s_ = L - 0.0894841775 * a - 1.291485548 * b;

		const lc = l_ * l_ * l_;
		const mc = m_ * m_ * m_;
		const sc = s_ * s_ * s_;

		const r = 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
		const g = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
		const bl = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc;

		const toSrgb = (v: number) => {
			const c = Math.max(0, Math.min(1, v));
			return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
		};

		const R = Math.round(toSrgb(r) * 255);
		const G = Math.round(toSrgb(g) * 255);
		const B = Math.round(toSrgb(bl) * 255);
		return A === 1 ? `rgb(${R}, ${G}, ${B})` : `rgba(${R}, ${G}, ${B}, ${A})`;
	}

	// Resolves a shadcn `--token` to a colour mermaid can parse.
	// The tokens in this project are oklch() values; mermaid's
	// colour parser only handles rgb/hex/hsl, so we convert in JS.
	function token(name: string): string {
		const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		if (!raw) return '';
		if (raw.startsWith('oklch')) return oklchToRgb(raw);
		return raw;
	}

	$effect(() => {
		if (!isMermaid || diagramId === 'mermaid-pending') return;
		// Subscribe to the colour mode so a theme flip re-renders.
		const isDark = mode.current === 'dark';
		void (async () => {
			try {
				const mermaid = (await import('mermaid')).default;
				mermaid.initialize({
					startOnLoad: false,
					theme: 'base',
					securityLevel: 'strict',
					fontFamily:
						'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
					themeVariables: {
						background: 'transparent',
						primaryColor: token('--primary'),
						primaryTextColor: token('--primary-foreground'),
						primaryBorderColor: token('--primary'),
						secondaryColor: token('--secondary'),
						secondaryTextColor: token('--secondary-foreground'),
						secondaryBorderColor: token('--border'),
						tertiaryColor: token('--muted'),
						tertiaryTextColor: token('--muted-foreground'),
						tertiaryBorderColor: token('--border'),
						mainBkg: token('--primary'),
						lineColor: token('--foreground'),
						textColor: token('--foreground'),
						nodeBorder: token('--border'),
						clusterBkg: token('--muted'),
						clusterBorder: token('--border'),
						edgeLabelBackground: token('--background'),
						fontSize: '14px'
					},
					flowchart: {
						curve: 'basis',
						htmlLabels: true,
						padding: 16,
						nodeSpacing: 50,
						rankSpacing: 60,
						useMaxWidth: true
					}
				});
				const { svg } = await mermaid.render(diagramId, content.trim());
				mermaidSvg = svg;
				mermaidError = null;
				// Mark the effect dependency so reactivity picks up the
				// theme change (mode.current was already read above).
				void isDark;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				mermaidError = msg;
				console.warn('[CodeBlock] mermaid render failed', { err });
			}
		})();
	});

	async function copy() {
		try {
			await navigator.clipboard.writeText(content);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// Clipboard API can fail in cross-origin iframes or under
			// strict CSP. No-op rather than crash; readers can still
			// select and copy by hand.
		}
	}
</script>

{#if isMermaid}
	<figure class="not-prose my-8">
		{#if mermaidError}
			<div
				class="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
			>
				<p class="font-medium">Mermaid render failed</p>
				<p class="mt-1 font-mono text-xs">{mermaidError}</p>
				<pre class="mt-2 overflow-x-auto text-xs text-muted-foreground"><code
						>{content}</code
					></pre>
			</div>
		{:else if mermaidSvg}
			<div class="mermaid-figure flex justify-center">
				{@html mermaidSvg}
			</div>
		{:else}
			<div class="flex h-32 items-center justify-center text-sm text-muted-foreground">
				Rendering diagram…
			</div>
		{/if}
	</figure>
{:else}
	<!-- Bare wrapper: the typography plugin's .prose pre rule supplies
	     the border / padding / background / margin. We add nothing
	     beyond positioning the absolute copy button. -->
	<div class="group relative">
		<Button
			variant="ghost"
			size="icon-sm"
			onclick={copy}
			aria-label={copied ? 'Copied' : 'Copy code'}
			class={cn(
				'absolute right-2 top-2 z-10 bg-muted/80 backdrop-blur',
				'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'
			)}
		>
			{#if copied}
				<Check class="size-4" />
			{:else}
				<Copy class="size-4" />
			{/if}
		</Button>

		{#if highlighted}
			<!-- Shiki returns its own <pre>; the typography plugin's
			     .prose pre rule styles the outer chrome and the .shiki
			     span colours below handle dual-theme token colours. -->
			{@html highlighted}
		{:else}
			<pre><code class="language-{language}">{content}</code></pre>
		{/if}
	</div>
{/if}

<style>
	/* Mermaid output polish. The library inlines most styling onto
	   SVG elements via themeVariables, but a few global tweaks help
	   it sit cleanly in prose. */
	:global(.mermaid-figure svg) {
		max-width: 100%;
		height: auto;
	}
	:global(.mermaid-figure .nodeLabel),
	:global(.mermaid-figure .edgeLabel) {
		font-weight: 500;
	}
	/* Edge labels: mermaid bakes textColor + edgeLabelBackground in
	   at render time. Re-rendering on mode flip races with the new
	   tokens (and mermaid sometimes carries the old fill into the
	   <rect> behind the foreignObject). Pin them to live CSS
	   variables so the .dark class flip handles theming without any
	   mermaid re-render at all. */
	:global(.mermaid-figure .edgeLabel),
	:global(.mermaid-figure .edgeLabel p),
	:global(.mermaid-figure .edgeLabel span) {
		color: var(--foreground) !important;
		background-color: var(--background) !important;
		font-size: 12px;
	}
	:global(.mermaid-figure .edgeLabel rect),
	:global(.mermaid-figure rect.label-background),
	:global(.mermaid-figure .edge-label-background) {
		fill: var(--background) !important;
	}

</style>
