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
						'code::after': { content: 'none' }
					}
				}
			}
		}
	}
};
