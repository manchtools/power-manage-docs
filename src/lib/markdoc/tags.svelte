<!--
  Markdoc *tag* registry — every {% custom %} block authors can use
  is a named re-export from this file. svelte-markdoc-preprocess
  parses the file as a Svelte AST and finds `export { default as X }
  from '...'` declarations; the export name becomes the tag name
  (lowercased — `Callout` → `{% callout %}`).

  Component prop names become Markdoc attribute names. The
  preprocessor reads the exported Svelte component's prop list at
  build time, so any new prop on Callout.svelte is automatically a
  valid Markdoc attribute. Define `prop` types explicitly in the
  component's $props() so the preprocessor picks them up.
-->
<script module>
	export { default as Callout } from './components/Callout.svelte';
	export { default as Tabs } from './components/Tabs.svelte';
	export { default as Tab } from './components/Tab.svelte';
	export { default as Flow } from './components/Flow.svelte';
</script>
