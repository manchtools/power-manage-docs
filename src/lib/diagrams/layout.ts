import { Position, type Node, type Edge, MarkerType } from '@xyflow/svelte';
import dagre from '@dagrejs/dagre';
import type { DiagramSpec, NodeKind, EdgeStyle } from './parse';

const NODE_W = 180;
const NODE_H = 56;
const NODESEP = 40;
const RANKSEP = 70;
const PAD = 16;

const BASE_NODE =
	'border-radius: 8px; padding: 8px 12px; font-size: 13px; line-height: 1.3; text-align: center; white-space: pre-line; font-weight: 500; box-shadow: 0 1px 2px hsl(var(--foreground) / 0.05);';

const STYLES: Record<NodeKind, string> = {
	service:
		BASE_NODE +
		'background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border: 1px solid hsl(var(--primary));',
	store:
		BASE_NODE +
		'background: hsl(var(--secondary)); color: hsl(var(--secondary-foreground)); border: 1px solid hsl(var(--border));',
	actor:
		BASE_NODE +
		'background: hsl(var(--background)); color: hsl(var(--foreground)); border: 1.5px dashed hsl(var(--muted-foreground));'
};

function edgeProps(style: EdgeStyle): Partial<Edge> {
	// labelBg / labelStyle aren't first-class props in Svelte Flow
	// (unlike React Flow) — label chrome is styled globally via CSS
	// in Mermaid.svelte's <style>. Per-edge we only control stroke
	// and arrowhead.
	const base: Partial<Edge> = {
		markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 }
	};
	switch (style) {
		case 'dashed':
			return {
				...base,
				animated: true,
				style: 'stroke: hsl(var(--muted-foreground)); stroke-width: 1.5px; stroke-dasharray: 6 4;'
			};
		case 'thick':
			return {
				...base,
				style: 'stroke: hsl(var(--foreground)); stroke-width: 2.5px;'
			};
		default:
			return {
				...base,
				style: 'stroke: hsl(var(--foreground) / 0.6); stroke-width: 1.5px;'
			};
	}
}

export type Laid = { nodes: Node[]; edges: Edge[]; height: number };

export function layout(spec: DiagramSpec): Laid {
	const g = new dagre.graphlib.Graph();
	g.setGraph({
		rankdir: spec.direction,
		nodesep: NODESEP,
		ranksep: RANKSEP,
		marginx: PAD,
		marginy: PAD
	});
	g.setDefaultEdgeLabel(() => ({}));

	for (const n of spec.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
	for (const e of spec.edges) g.setEdge(e.from, e.to);
	dagre.layout(g);

	const horizontal = spec.direction === 'LR' || spec.direction === 'RL';
	const sourceP = horizontal ? Position.Right : Position.Bottom;
	const targetP = horizontal ? Position.Left : Position.Top;

	const nodes: Node[] = spec.nodes.map((n) => {
		const { x, y } = g.node(n.id);
		return {
			id: n.id,
			position: { x: x - NODE_W / 2, y: y - NODE_H / 2 },
			data: { label: n.label },
			style: STYLES[n.kind],
			sourcePosition: sourceP,
			targetPosition: targetP,
			width: NODE_W,
			height: NODE_H,
			draggable: false,
			selectable: false,
			connectable: false
		};
	});

	const edges: Edge[] = spec.edges.map((e, i) => ({
		id: `${e.from}->${e.to}#${i}`,
		source: e.from,
		target: e.to,
		label: e.label,
		...edgeProps(e.style)
	}));

	const height = (g.graph().height ?? 0) + PAD * 2;
	return { nodes, edges, height };
}
