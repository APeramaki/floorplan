<script lang="ts">
	import { onMount } from 'svelte';

	import {
		closestPointOnSegmentMm,
		distanceMm,
		formatAreaLabel,
		formatLengthLabel,
		midpoint,
		polygonAreaMm2,
		polygonCentroid,
		snapToPoints
	} from '$lib/floorplan/geometry';
	import type { Point, RectFurniture, ToolMode, ViewBox } from '$lib/floorplan/models';
	import {
		addRectFurniture,
		addRoom,
		addWall,
		planStore,
		updateRectFurniture
	} from '$lib/floorplan/stores/planStore';

	type RectDefaults = { name: string; widthMm: number; heightMm: number };

	let {
		tool = 'select',
		selectedFurnitureId = undefined,
		rectDefaults = { name: 'Furniture', widthMm: 800, heightMm: 600 },
		onSelectFurniture = () => {},
		onFurnitureCreated = () => {}
	} = $props<{
		tool?: ToolMode;
		selectedFurnitureId?: string;
		rectDefaults?: RectDefaults;
		onSelectFurniture?: (id: string | undefined) => void;
		onFurnitureCreated?: (id: string) => void;
	}>();

	let svgEl: SVGSVGElement | null = null;

	let viewBox: ViewBox = $state({ x: -5000, y: -5000, w: 10000, h: 10000 });

	let isPanning = $state(false);
	let panStartClient: { x: number; y: number } | null = $state(null);
	let panStartViewBox: ViewBox | null = $state(null);

	let hoverWorld: Point | null = $state(null);
	let hoverPoint: Point | null = $state(null);
	let hoverSnapped = $state(false);

	let draftWall: Point[] = $state([]);
	let draftRoom: Point[] = $state([]);

	type FurnitureDragState =
		| {
				kind: 'move';
				id: string;
				startWorld: Point;
				startRect: Pick<RectFurniture, 'x' | 'y' | 'widthMm' | 'heightMm'>;
		  }
		| {
				kind: 'resize';
				id: string;
				handle: 'nw' | 'ne' | 'sw' | 'se';
				startWorld: Point;
				startRect: Pick<RectFurniture, 'x' | 'y' | 'widthMm' | 'heightMm'>;
		  };

	let furnitureDrag: FurnitureDragState | null = $state(null);

	const SNAP_PX = 10;
	const EPS = 1e-3;

	function getViewScaleAndOffset() {
		if (!svgEl) return { scale: 1, offsetX: 0, offsetY: 0, rect: null as DOMRect | null };
		const rect = svgEl.getBoundingClientRect();

		// We rely on preserveAspectRatio="xMidYMid meet".
		const scale = Math.min(rect.width / viewBox.w, rect.height / viewBox.h);
		const offsetX = (rect.width - viewBox.w * scale) / 2;
		const offsetY = (rect.height - viewBox.h * scale) / 2;
		return { scale, offsetX, offsetY, rect };
	}

	function clientToWorld(clientX: number, clientY: number): Point {
		if (!svgEl) return { x: 0, y: 0 };
		const { scale, offsetX, offsetY, rect } = getViewScaleAndOffset();
		if (!rect) return { x: 0, y: 0 };

		const localX = clientX - rect.left - offsetX;
		const localY = clientY - rect.top - offsetY;

		const nx = localX / (viewBox.w * scale);
		const ny = localY / (viewBox.h * scale);

		return {
			x: viewBox.x + nx * viewBox.w,
			y: viewBox.y + ny * viewBox.h
		};
	}

	function snapToleranceMm(): number {
		const { scale } = getViewScaleAndOffset();
		// px -> mm
		return SNAP_PX / scale;
	}

	function snapAxisToNodes(
		p: Point,
		candidates: Point[],
		toleranceMm: number,
		allowX: boolean,
		allowY: boolean
	) {
		let bestDx = Infinity;
		let bestDy = Infinity;
		let snapX: number | null = null;
		let snapY: number | null = null;

		for (const c of candidates) {
			if (allowX) {
				const dx = Math.abs(c.x - p.x);
				if (dx < bestDx) {
					bestDx = dx;
					snapX = c.x;
				}
			}
			if (allowY) {
				const dy = Math.abs(c.y - p.y);
				if (dy < bestDy) {
					bestDy = dy;
					snapY = c.y;
				}
			}
		}

		const snappedX = allowX && snapX !== null && bestDx <= toleranceMm;
		const snappedY = allowY && snapY !== null && bestDy <= toleranceMm;

		return {
			point: {
				x: snappedX ? snapX! : p.x,
				y: snappedY ? snapY! : p.y
			},
			snapped: snappedX || snappedY
		};
	}

	function getNodeCandidates(options?: {
		includeDraftWall?: boolean;
		includeDraftRoom?: boolean;
	}): Point[] {
		const points: Point[] = [];
		for (const w of $planStore.walls) {
			points.push(w.a, w.b);
		}
		for (const r of $planStore.rooms) {
			for (const p of r.polygon) points.push(p);
		}

		if (options?.includeDraftWall) {
			points.push(...draftWall);
		}
		if (options?.includeDraftRoom) {
			points.push(...draftRoom);
		}

		return points;
	}

	function samePoint(a: Point, b: Point): boolean {
		return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
	}

	function updateHover(clientX: number, clientY: number) {
		const world = clientToWorld(clientX, clientY);
		hoverWorld = world;

		const tol = snapToleranceMm();
		const candidates = getNodeCandidates({
			includeDraftWall: tool === 'draw-wall',
			includeDraftRoom: tool === 'draw-room'
		});

		if (tool === 'draw-room' && draftRoom.length > 0) {
			const from = draftRoom[draftRoom.length - 1];
			const dx = Math.abs(world.x - from.x);
			const dy = Math.abs(world.y - from.y);
			const horizontal = dx >= dy;

			const ortho: Point = horizontal ? { x: world.x, y: from.y } : { x: from.x, y: world.y };

			// Axis snapping for rooms: only along the moving axis (keep right angle).
			const axisRes = snapAxisToNodes(ortho, candidates, tol, horizontal, !horizontal);
			const pointRes = snapToPoints(axisRes.point, candidates, tol);

			hoverPoint = pointRes.isSnapped ? pointRes.point : axisRes.point;
			hoverSnapped = axisRes.snapped || pointRes.isSnapped;
			return;
		}

		// Walls and everything else: axis snap on x/y, then point snap if close.
		const axisRes = snapAxisToNodes(world, candidates, tol, true, true);
		const pointRes = snapToPoints(axisRes.point, candidates, tol);

		hoverPoint = pointRes.isSnapped ? pointRes.point : axisRes.point;
		hoverSnapped = axisRes.snapped || pointRes.isSnapped;
	}

	function onWheel(e: WheelEvent) {
		if (!svgEl) return;
		e.preventDefault();

		// Smooth zoom; deltaY>0 zoom out.
		const zoom = Math.exp(-e.deltaY * 0.001);
		const minW = 500;
		const maxW = 200000;

		const anchor = clientToWorld(e.clientX, e.clientY);

		const nextW = clamp(viewBox.w / zoom, minW, maxW);
		const nextH = (nextW / viewBox.w) * viewBox.h;

		const k = nextW / viewBox.w;
		// Keep anchor point fixed in screen space.
		const nextX = anchor.x - (anchor.x - viewBox.x) * k;
		const nextY = anchor.y - (anchor.y - viewBox.y) * k;

		viewBox = { x: nextX, y: nextY, w: nextW, h: nextH };
	}

	function onPointerDown(e: PointerEvent) {
		if (!svgEl) return;

		svgEl.focus();
		updateHover(e.clientX, e.clientY);

		const wantsPan = tool === 'pan' || e.shiftKey || e.button === 1;
		if (wantsPan) {
			e.preventDefault();
			svgEl.setPointerCapture(e.pointerId);
			isPanning = true;
			panStartClient = { x: e.clientX, y: e.clientY };
			panStartViewBox = { ...viewBox };
			return;
		}

		if (e.button !== 0) return;

		const p = hoverPoint ?? hoverWorld;
		if (!p) return;

		if (tool === 'place-rect') {
			const w = Math.max(1, rectDefaults.widthMm);
			const h = Math.max(1, rectDefaults.heightMm);
			const id = addRectFurniture({
				name: rectDefaults.name,
				x: p.x - w / 2,
				y: p.y - h / 2,
				widthMm: w,
				heightMm: h
			});
			onFurnitureCreated(id);
			onSelectFurniture(id);
			return;
		}

		if (tool === 'draw-wall') {
			const last = draftWall.at(-1);
			if (!last || !samePoint(last, p)) draftWall = [...draftWall, p];
			return;
		}

		if (tool === 'draw-room') {
			if (draftRoom.length === 0) {
				draftRoom = [p];
				return;
			}

			const last = draftRoom[draftRoom.length - 1];
			if (samePoint(last, p)) return;

			const first = draftRoom[0];
			const tol = snapToleranceMm();

			if (draftRoom.length >= 3) {
				const canClose = Math.abs(first.x - last.x) <= EPS || Math.abs(first.y - last.y) <= EPS;
				const closeDist = distanceMm(p, first);
				if (canClose && closeDist <= tol) {
					// Close + commit.
					commitRoom();
					return;
				}
			}

			// Ensure orthogonal step and avoid creating a diagonal close.
			const isOrthogonalStep = Math.abs(p.x - last.x) <= EPS || Math.abs(p.y - last.y) <= EPS;
			if (!isOrthogonalStep) {
				// This can happen if the user snapped to an unaligned node.
				// Ignore the snap and keep the orthogonal preview point.
				const world = hoverWorld ?? p;
				const dx = Math.abs(world.x - last.x);
				const dy = Math.abs(world.y - last.y);
				const horizontal = dx >= dy;
				const ortho: Point = horizontal ? { x: world.x, y: last.y } : { x: last.x, y: world.y };
				const res = snapToPoints(
					ortho,
					getNodeCandidates({ includeDraftRoom: true }).filter((c) =>
						horizontal ? Math.abs(c.y - last.y) <= tol : Math.abs(c.x - last.x) <= tol
					),
					tol
				);
				draftRoom = [...draftRoom, res.point];
				return;
			}

			draftRoom = [...draftRoom, p];
			return;
		}

		if (tool === 'select') {
			onSelectFurniture(undefined);
		}
	}

	function onPointerMove(e: PointerEvent) {
		if (!svgEl) return;

		if (furnitureDrag) {
			e.preventDefault();
			const cur = clientToWorld(e.clientX, e.clientY);
			const dx = cur.x - furnitureDrag.startWorld.x;
			const dy = cur.y - furnitureDrag.startWorld.y;

			if (furnitureDrag.kind === 'move') {
				let x = furnitureDrag.startRect.x + dx;
				let y = furnitureDrag.startRect.y + dy;

				// Snap to nearest wall segment when the rect center gets close.
				const center: Point = {
					x: x + furnitureDrag.startRect.widthMm / 2,
					y: y + furnitureDrag.startRect.heightMm / 2
				};
				const tol = snapToleranceMm();

				let best: { pt: Point; dist: number } | null = null;
				for (const w of $planStore.walls) {
					const pt = closestPointOnSegmentMm(center, w.a, w.b);
					const dist = distanceMm(center, pt);
					if (!best || dist < best.dist) best = { pt, dist };
				}

				if (best && best.dist <= tol) {
					x += best.pt.x - center.x;
					y += best.pt.y - center.y;
				}

				updateRectFurniture(furnitureDrag.id, { x, y });
				return;
			}

			const minSize = 10;
			let x = furnitureDrag.startRect.x;
			let y = furnitureDrag.startRect.y;
			let w = furnitureDrag.startRect.widthMm;
			let h = furnitureDrag.startRect.heightMm;

			switch (furnitureDrag.handle) {
				case 'se':
					w = furnitureDrag.startRect.widthMm + dx;
					h = furnitureDrag.startRect.heightMm + dy;
					break;
				case 'sw':
					x = furnitureDrag.startRect.x + dx;
					w = furnitureDrag.startRect.widthMm - dx;
					h = furnitureDrag.startRect.heightMm + dy;
					break;
				case 'ne':
					y = furnitureDrag.startRect.y + dy;
					w = furnitureDrag.startRect.widthMm + dx;
					h = furnitureDrag.startRect.heightMm - dy;
					break;
				case 'nw':
					x = furnitureDrag.startRect.x + dx;
					y = furnitureDrag.startRect.y + dy;
					w = furnitureDrag.startRect.widthMm - dx;
					h = furnitureDrag.startRect.heightMm - dy;
					break;
			}

			if (w < minSize) {
				const delta = minSize - w;
				w = minSize;
				if (furnitureDrag.handle === 'sw' || furnitureDrag.handle === 'nw') x -= delta;
			}
			if (h < minSize) {
				const delta = minSize - h;
				h = minSize;
				if (furnitureDrag.handle === 'ne' || furnitureDrag.handle === 'nw') y -= delta;
			}

			updateRectFurniture(furnitureDrag.id, { x, y, widthMm: w, heightMm: h });
			return;
		}

		if (isPanning && panStartClient && panStartViewBox) {
			e.preventDefault();
			const { scale } = getViewScaleAndOffset();
			const dxClient = e.clientX - panStartClient.x;
			const dyClient = e.clientY - panStartClient.y;
			const dxWorld = -dxClient / scale;
			const dyWorld = -dyClient / scale;

			viewBox = {
				x: panStartViewBox.x + dxWorld,
				y: panStartViewBox.y + dyWorld,
				w: panStartViewBox.w,
				h: panStartViewBox.h
			};
			return;
		}

		updateHover(e.clientX, e.clientY);
	}

	function onPointerUp(e: PointerEvent) {
		if (!svgEl) return;

		if (furnitureDrag) {
			e.preventDefault();
			furnitureDrag = null;
			return;
		}

		if (!isPanning) return;
		e.preventDefault();
		isPanning = false;
		panStartClient = null;
		panStartViewBox = null;
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape' && furnitureDrag) {
			e.preventDefault();
			furnitureDrag = null;
			return;
		}
		if (tool === 'draw-wall' && draftWall.length > 0) {
			if (e.key === 'Enter') {
				e.preventDefault();
				commitWalls();
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				draftWall = [];
			}
			if (e.key === 'Backspace') {
				e.preventDefault();
				draftWall = draftWall.slice(0, -1);
			}
			return;
		}

		if (tool === 'draw-room' && draftRoom.length > 0) {
			if (e.key === 'Enter') {
				e.preventDefault();
				commitRoom();
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				draftRoom = [];
			}
			if (e.key === 'Backspace') {
				e.preventDefault();
				draftRoom = draftRoom.slice(0, -1);
			}
		}
	}

	function commitWalls() {
		if (draftWall.length < 2) return;
		for (let i = 0; i < draftWall.length - 1; i++) {
			addWall(draftWall[i], draftWall[i + 1]);
		}
		draftWall = [];
	}

	function commitRoom() {
		if (draftRoom.length < 4) return;
		const first = draftRoom[0];
		const last = draftRoom[draftRoom.length - 1];
		const canClose = Math.abs(first.x - last.x) <= EPS || Math.abs(first.y - last.y) <= EPS;
		if (!canClose) return;
		addRoom(draftRoom);
		draftRoom = [];
	}

	function clamp(v: number, min: number, max: number): number {
		return Math.max(min, Math.min(max, v));
	}

	// Avoid passive wheel listeners on some browsers.
	onMount(() => {
		if (!svgEl) return;
		svgEl.addEventListener('wheel', onWheel, { passive: false });
		return () => svgEl?.removeEventListener('wheel', onWheel);
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<svg
	bind:this={svgEl}
	class="plan-svg"
	class:pan-cursor={tool === 'pan'}
	tabindex="0"
	viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
	preserveAspectRatio="xMidYMid meet"
	role="application"
	aria-label="Floor plan editor"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onkeydown={onKeyDown}
>
	<rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill="#0b1220" />

	<!-- Reference image -->
	{#if $planStore.referenceImage}
		<image
			href={$planStore.referenceImage.dataUrl}
			x={$planStore.referenceImage.x}
			y={$planStore.referenceImage.y}
			width={$planStore.referenceImage.widthMm}
			height={$planStore.referenceImage.heightMm}
			opacity={$planStore.referenceImage.opacity}
			preserveAspectRatio="none"
			pointer-events="none"
		/>
	{/if}

	<!-- Rooms -->
	<g>
		{#each $planStore.rooms as room (room.id)}
			<polygon
				points={room.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
				fill="rgba(59,130,246,0.14)"
				stroke="rgba(59,130,246,0.7)"
				stroke-width="10"
			/>

			{#if room.polygon.length >= 3}
				{@const area = polygonAreaMm2(room.polygon)}
				{@const c = polygonCentroid(room.polygon)}
				<text
					x={c.x}
					y={c.y}
					fill="rgba(226,232,240,0.95)"
					font-size="120"
					text-anchor="middle"
					pointer-events="none"
				>
					{formatAreaLabel(area)}
				</text>
			{/if}
		{/each}

		<!-- Draft room -->
		{#if tool === 'draw-room' && draftRoom.length > 0}
			{@const preview = hoverPoint ?? draftRoom[draftRoom.length - 1]}
			<polyline
				points={[...draftRoom, preview].map((p) => `${p.x},${p.y}`).join(' ')}
				fill="none"
				stroke="rgba(59,130,246,0.85)"
				stroke-width="10"
				stroke-dasharray="40 30"
			/>
			{#each draftRoom as p, idx (idx)}
				<circle cx={p.x} cy={p.y} r="40" fill="rgba(59,130,246,0.85)" pointer-events="none" />
			{/each}
		{/if}
	</g>

	<!-- Furniture -->
	<g>
		{#each $planStore.furniture as f (f.id)}
			{#if f.kind === 'rect'}
				{@const isSelected = f.id === selectedFurnitureId}
				<rect
					role="button"
					tabindex="-1"
					aria-label={`Furniture: ${f.name}`}
					x={f.x}
					y={f.y}
					width={f.widthMm}
					height={f.heightMm}
					fill={isSelected ? 'rgba(250,204,21,0.20)' : 'rgba(226,232,240,0.12)'}
					stroke={isSelected ? 'rgba(250,204,21,0.9)' : 'rgba(226,232,240,0.35)'}
					stroke-width="10"
					onpointerdown={(e) => {
						if (tool !== 'select') return;
						e.preventDefault();
						e.stopPropagation();
						onSelectFurniture(f.id);
						if (!svgEl) return;
						svgEl.setPointerCapture(e.pointerId);
						furnitureDrag = {
							kind: 'move',
							id: f.id,
							startWorld: clientToWorld(e.clientX, e.clientY),
							startRect: { x: f.x, y: f.y, widthMm: f.widthMm, heightMm: f.heightMm }
						};
					}}
				/>
				<text
					x={f.x + f.widthMm / 2}
					y={f.y - 40}
					fill="rgba(226,232,240,0.8)"
					font-size="120"
					text-anchor="middle"
					pointer-events="none"
				>
					{f.name}
				</text>

				{#if isSelected}
					{@const handleSize = 80}
					{#each ['nw', 'ne', 'sw', 'se'] as const as hdl (hdl)}
						{@const hx = hdl.endsWith('e') ? f.x + f.widthMm : f.x}
						{@const hy = hdl.startsWith('s') ? f.y + f.heightMm : f.y}
						<rect
							role="button"
							tabindex="-1"
							aria-label={`Resize handle ${hdl}`}
							x={hx - handleSize / 2}
							y={hy - handleSize / 2}
							width={handleSize}
							height={handleSize}
							fill="rgba(250,204,21,0.9)"
							stroke="rgba(2,6,23,0.6)"
							stroke-width="10"
							onpointerdown={(e) => {
								if (tool !== 'select') return;
								e.preventDefault();
								e.stopPropagation();
								onSelectFurniture(f.id);
								if (!svgEl) return;
								svgEl.setPointerCapture(e.pointerId);
								furnitureDrag = {
									kind: 'resize',
									id: f.id,
									handle: hdl,
									startWorld: clientToWorld(e.clientX, e.clientY),
									startRect: { x: f.x, y: f.y, widthMm: f.widthMm, heightMm: f.heightMm }
								};
							}}
						/>
					{/each}
				{/if}
			{/if}
		{/each}
	</g>

	<!-- Walls -->
	<g>
		{#each $planStore.walls as wall (wall.id)}
			<line
				x1={wall.a.x}
				y1={wall.a.y}
				x2={wall.b.x}
				y2={wall.b.y}
				stroke="#e2e8f0"
				stroke-width={wall.thicknessMm}
				stroke-linecap="round"
			/>

			{@const m = midpoint(wall.a, wall.b)}
			{@const len = distanceMm(wall.a, wall.b)}
			<text
				x={m.x}
				y={m.y}
				fill="rgba(226,232,240,0.95)"
				font-size="120"
				text-anchor="middle"
				pointer-events="none"
			>
				{formatLengthLabel(len)}
			</text>
		{/each}

		<!-- Draft wall -->
		{#if tool === 'draw-wall' && draftWall.length > 0}
			{@const preview = hoverPoint ?? draftWall[draftWall.length - 1]}
			<polyline
				points={[...draftWall, preview].map((p) => `${p.x},${p.y}`).join(' ')}
				fill="none"
				stroke="rgba(226,232,240,0.95)"
				stroke-width="20"
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-dasharray="60 40"
			/>
			{#each draftWall as p, idx (idx)}
				<circle cx={p.x} cy={p.y} r="40" fill="rgba(226,232,240,0.95)" pointer-events="none" />
			{/each}
		{/if}
	</g>

	<!-- Cursor indicator -->
	{#if hoverPoint}
		<circle
			cx={hoverPoint.x}
			cy={hoverPoint.y}
			r={hoverSnapped ? 60 : 40}
			fill={hoverSnapped ? 'rgba(34,197,94,0.8)' : 'rgba(148,163,184,0.8)'}
			pointer-events="none"
		/>
	{/if}
</svg>

<style>
	.plan-svg {
		width: 100%;
		height: 100%;
		touch-action: none;
		user-select: none;
		cursor: crosshair;
		outline: none;
	}

	.plan-svg.pan-cursor {
		cursor: grab;
	}
</style>
