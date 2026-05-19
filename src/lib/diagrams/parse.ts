// Parses a small subset of Mermaid flowchart syntax into a typed
// spec that the SvelteFlow renderer can consume. The point is to
// keep authoring Mermaid-flavoured (markdown-friendly, no per-node
// coordinates) while rendering with SvelteFlow's nicer node/edge
// chrome.
//
// Supported syntax:
//
//   flowchart LR           -- direction (LR, RL, TB, BT, TD)
//   A[Label]               -- service (default rectangle)
//   A[(Label)]             -- store   (cylinder shape in Mermaid)
//   A((Label))             -- actor   (circle shape in Mermaid)
//   A --> B                -- solid edge
//   A -.-> B               -- dashed/async edge (rendered animated)
//   A ==> B                -- thick edge
//   A -->|label| B         -- edge with mid-label
//   <br/> / <br>           -- in node labels: line break
//   %% comment             -- line comment
//
// Not supported: subgraphs, classDef, click handlers, multi-target
// shorthands (`A --> B & C`), Mermaid's `direction TB` inside a
// subgraph. If an author needs more, we'll add it.

export type NodeKind = 'service' | 'store' | 'actor';

export type SpecNode = {
	id: string;
	label: string;
	kind: NodeKind;
};

export type EdgeStyle = 'solid' | 'dashed' | 'thick';

export type SpecEdge = {
	from: string;
	to: string;
	label?: string;
	style: EdgeStyle;
};

export type DiagramSpec = {
	direction: 'LR' | 'RL' | 'TB' | 'BT';
	nodes: SpecNode[];
	edges: SpecEdge[];
};

export class MermaidParseError extends Error {
	line: number;
	source: string;
	constructor(message: string, line: number, source: string) {
		super(`mermaid:${line}: ${message}`);
		this.line = line;
		this.source = source;
	}
}

// Matches a node reference: `<id>` or `<id><shape>`. Shape is one of
// `[(...)]`, `((...))`, `[...]`, `(...)`. Captured groups: 1 = id,
// 2 = shape-including-brackets (may be undefined).
const NODE = String.raw`([A-Za-z_][\w]*)(\[\([^\]]*\)\]|\(\([^\)]*\)\)|\[[^\]]*\]|\([^\)]*\))?`;

// Edge arrow forms. Order matters: longer/more-specific patterns
// first so `-.->` doesn't get partial-matched by `-->`.
const ARROW = String.raw`(-\.->|==>|-->)`;

// Optional edge label: `|...|` immediately after the arrow.
const LABEL = String.raw`(?:\|([^|]+)\|)?`;

const EDGE_LINE = new RegExp(`^${NODE}\\s*${ARROW}\\s*${LABEL}\\s*${NODE}$`);

const DIRECTION_LINE = /^(?:flowchart|graph)\s+(LR|RL|TB|BT|TD)\s*$/i;

function decodeLabel(raw: string): string {
	// Mermaid uses <br/> / <br> for line breaks inside labels and
	// HTML-escaped ampersands etc. for the rest. We only need the
	// line break — quoted strings and escapes can come later.
	return raw.replace(/<br\s*\/?>/gi, '\n').trim();
}

function parseNodeRef(id: string, shape: string | undefined): SpecNode {
	if (!shape) return { id, kind: 'service', label: id };
	if (shape.startsWith('[(') && shape.endsWith(')]')) {
		return { id, kind: 'store', label: decodeLabel(shape.slice(2, -2)) };
	}
	if (shape.startsWith('((') && shape.endsWith('))')) {
		return { id, kind: 'actor', label: decodeLabel(shape.slice(2, -2)) };
	}
	if (shape.startsWith('[') && shape.endsWith(']')) {
		return { id, kind: 'service', label: decodeLabel(shape.slice(1, -1)) };
	}
	if (shape.startsWith('(') && shape.endsWith(')')) {
		return { id, kind: 'actor', label: decodeLabel(shape.slice(1, -1)) };
	}
	return { id, kind: 'service', label: id };
}

function styleForArrow(arrow: string): EdgeStyle {
	if (arrow === '-.->') return 'dashed';
	if (arrow === '==>') return 'thick';
	return 'solid';
}

export function parseMermaid(source: string): DiagramSpec {
	let direction: DiagramSpec['direction'] = 'LR';
	const nodes = new Map<string, SpecNode>();
	const edges: SpecEdge[] = [];

	const lines = source.split('\n');
	let sawDirection = false;

	const remember = (node: SpecNode) => {
		const existing = nodes.get(node.id);
		// First declaration with an explicit shape wins. A bare
		// reference (no shape => kind 'service', label === id) never
		// overrides an earlier richer declaration.
		if (!existing) {
			nodes.set(node.id, node);
			return;
		}
		const existingIsBare = existing.label === existing.id && existing.kind === 'service';
		const newIsBare = node.label === node.id && node.kind === 'service';
		if (existingIsBare && !newIsBare) nodes.set(node.id, node);
	};

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const lineNum = i + 1;
		// Strip Mermaid comments (`%%...`) and trim.
		const stripped = raw.replace(/%%.*$/, '').trim();
		if (!stripped) continue;

		const dir = stripped.match(DIRECTION_LINE);
		if (dir) {
			if (sawDirection) {
				throw new MermaidParseError('duplicate flowchart direction', lineNum, raw);
			}
			// 'TD' is a Mermaid alias for 'TB'.
			const d = dir[1].toUpperCase();
			direction = d === 'TD' ? 'TB' : (d as DiagramSpec['direction']);
			sawDirection = true;
			continue;
		}

		const m = stripped.match(EDGE_LINE);
		if (!m) {
			throw new MermaidParseError(
				`expected edge declaration, got: ${stripped}`,
				lineNum,
				raw
			);
		}
		const [, srcId, srcShape, arrow, edgeLabel, dstId, dstShape] = m;
		const src = parseNodeRef(srcId, srcShape);
		const dst = parseNodeRef(dstId, dstShape);
		remember(src);
		remember(dst);
		edges.push({
			from: src.id,
			to: dst.id,
			label: edgeLabel ? decodeLabel(edgeLabel) : undefined,
			style: styleForArrow(arrow)
		});
	}

	return { direction, nodes: [...nodes.values()], edges };
}
