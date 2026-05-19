<!--
  Markdoc *node* overrides — built-in Markdown elements whose
  rendering we want to customise. Export names match Markdoc's
  built-in node names (lowercased):

    Heading → heading       (we add id anchors for the TOC)
    Link    → link          (external links get rel/target attrs)
    Fence   → fence (code)  (shiki syntax highlighting + copy button)

  Anything not listed here falls through to Markdoc's default
  renderer, which emits plain HTML and gets typographic styling
  via the .prose rules in app.css.
-->
<script module>
	export { default as Heading } from './components/Heading.svelte';
	export { default as Link } from './components/Link.svelte';
	export { default as Fence } from './components/CodeBlock.svelte';
</script>
