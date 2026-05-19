/**
 * Tailwind config used only to customise @tailwindcss/typography.
 * Everything else in this project (theme tokens, @import "tailwindcss",
 * the @plugin directive, etc.) lives in src/app.css. Tailwind v4's
 * `@config` directive in app.css pulls this file in so the typography
 * plugin can read the `theme.extend.typography` overrides below.
 *
 * Why a JS file in a v4 project: the plugin's per-rule overrides
 * (e.g. dropping `code::before` content) aren't exposable through the
 * v4 CSS-only `@theme` block — those are design tokens, not arbitrary
 * style declarations. So we keep this one legacy-shaped file for the
 * typography plugin's sake.
 */
export default {
	theme: {
		extend: {
			typography: {
				DEFAULT: {
					css: {
						// Drop the literal backtick characters the plugin
						// adds around inline <code>. Default is content: '`'.
						'code::before': { content: 'none' },
						'code::after': { content: 'none' },
						// Give inline <code> a subtle chip background so it
						// reads as a distinct token in flowing prose. The
						// plugin's default is bold text on the page bg,
						// which doesn't stand out against the body copy.
						code: {
							backgroundColor: 'var(--muted)',
							padding: '0.125rem 0.375rem',
							borderRadius: '0.25rem',
							fontWeight: '500'
						},
						// Inside <pre> we don't want the chip — Shiki/the
						// pre block already styles the whole region.
						// Reset everything we set on `code`.
						'pre code': {
							backgroundColor: 'transparent',
							padding: '0',
							borderRadius: '0',
							fontWeight: 'inherit'
						}
					}
				}
			}
		}
	}
};
