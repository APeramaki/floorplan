<script lang="ts">
	import { distanceMm } from '$lib/floorplan/geometry';
	import type { Point } from '$lib/floorplan/models';

	type Segment = { lengthMm: number; turnDeg: number };

	let {
		onCancel = () => {},
		onCreate = (_: { name: string; points: Point[] }) => {}
	} = $props<{
		onCancel?: () => void;
		onCreate?: (shape: { name: string; points: Point[] }) => void;
	}>();

	let name = $state('Custom shape');
	let originX = $state(0);
	let originY = $state(0);
	let startAngleDeg = $state(0);
	let closeToleranceMm = $state(0.5);
	let requireClosed = $state(true);

	let segments: Segment[] = $state([
		{ lengthMm: 1000, turnDeg: 90 },
		{ lengthMm: 1000, turnDeg: 90 },
		{ lengthMm: 1000, turnDeg: 90 },
		{ lengthMm: 1000, turnDeg: 90 }
	]);

	function normalizeDeg(deg: number): number {
		return ((deg % 360) + 360) % 360;
	}

	function degToRad(deg: number): number {
		return (deg * Math.PI) / 180;
	}

	function computePoints(): Point[] {
		let angleDeg = startAngleDeg;
		let x = originX;
		let y = originY;
		const pts: Point[] = [{ x, y }];

		for (const seg of segments) {
			const len = Number(seg.lengthMm);
			if (!Number.isFinite(len) || len <= 0) continue;

			const a = degToRad(angleDeg);
			x += len * Math.cos(a);
			y += len * Math.sin(a);
			pts.push({ x, y });

			const turn = Number(seg.turnDeg);
			if (Number.isFinite(turn)) angleDeg += turn;
		}

		return pts;
	}

	function closureErrorMm(pts: Point[]): number {
		if (pts.length < 2) return Infinity;
		return distanceMm(pts[0], pts[pts.length - 1]);
	}

	function canCreate(pts: Point[]): boolean {
		if (pts.length < 4) return false; // start + 3 segments minimum
		const err = closureErrorMm(pts);
		if (requireClosed) return err <= closeToleranceMm;
		return true;
	}

	function effectivePolygonPoints(pts: Point[]): Point[] {
		// If the path returns to origin (within tolerance), drop the duplicate last point.
		if (pts.length >= 2 && closureErrorMm(pts) <= closeToleranceMm) {
			return pts.slice(0, -1);
		}
		return pts;
	}

	function updateSegment(i: number, patch: Partial<Segment>) {
		segments = segments.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
	}

	function addSegment() {
		segments = [...segments, { lengthMm: 1000, turnDeg: 90 }];
	}

	function removeLastSegment() {
		if (segments.length <= 1) return;
		segments = segments.slice(0, -1);
	}

	let pts = $derived(computePoints());
	let err = $derived(closureErrorMm(pts));
	let effectivePts = $derived(effectivePolygonPoints(pts));
	let createEnabled = $derived(canCreate(pts));

	type BBox = { minX: number; minY: number; maxX: number; maxY: number };

	function bboxOf(points: Point[]): BBox | null {
		if (points.length === 0) return null;
		let minX = points[0].x;
		let minY = points[0].y;
		let maxX = points[0].x;
		let maxY = points[0].y;
		for (const p of points) {
			minX = Math.min(minX, p.x);
			minY = Math.min(minY, p.y);
			maxX = Math.max(maxX, p.x);
			maxY = Math.max(maxY, p.y);
		}
		return { minX, minY, maxX, maxY };
	}

	let previewBox = $derived.by(() => {
		const b = bboxOf(effectivePts);
		if (!b) return { x: -1, y: -1, w: 2, h: 2 };
		const pad = 0.08;
		const w = Math.max(1e-6, b.maxX - b.minX);
		const h = Math.max(1e-6, b.maxY - b.minY);
		return {
			x: b.minX - w * pad,
			y: b.minY - h * pad,
			w: w * (1 + pad * 2),
			h: h * (1 + pad * 2)
		};
	});

	function onSubmit() {
		if (!createEnabled) return;
		onCreate({ name: name.trim() ? name.trim() : 'Custom shape', points: effectivePts });
	}
</script>

<div
	class="overlay"
	onclick={(e) => {
		// Only close when clicking the backdrop, not the dialog content.
		if (e.target === e.currentTarget) onCancel();
	}}
	role="presentation"
>
	<div class="dialog" role="dialog" aria-modal="true" tabindex="0">
		<header>
			<h2>Custom shape builder</h2>
			<p class="hint">
				Build a closed polygon by entering segment <strong>lengths</strong> and <strong>turn angles</strong>.
				Angles are degrees, where 0° = +X, 90° = +Y (down).
			</p>
		</header>

		<div class="grid">
			<label>
				Name
				<input type="text" bind:value={name} />
			</label>
			<label>
				Origin X (mm)
				<input type="number" step="10" bind:value={originX} />
			</label>
			<label>
				Origin Y (mm)
				<input type="number" step="10" bind:value={originY} />
			</label>
			<label>
				Start angle (°)
				<input type="number" step="1" value={normalizeDeg(startAngleDeg)} oninput={(e) => {
					const v = Number((e.currentTarget as HTMLInputElement).value);
					if (Number.isFinite(v)) startAngleDeg = v;
				}} />
			</label>
		</div>

		<div class="options">
			<label class="inline">
				<input type="checkbox" bind:checked={requireClosed} />
				Require closed shape
			</label>
			<label class="inline">
				Tolerance (mm)
				<input type="number" min="0" step="0.1" bind:value={closeToleranceMm} />
			</label>
		</div>

		<h3>Segments</h3>
		<div class="segments">
			<div class="row header">
				<div>#</div>
				<div>Length (mm)</div>
				<div>Turn after (°)</div>
			</div>
			{#each segments as seg, i (i)}
				<div class="row">
					<div>{i + 1}</div>
					<input
						type="number"
						min="0"
						step="1"
						value={seg.lengthMm}
						oninput={(e) =>
							updateSegment(i, { lengthMm: Number((e.currentTarget as HTMLInputElement).value) })}
					/>
					<input
						type="number"
						step="1"
						value={seg.turnDeg}
						oninput={(e) =>
							updateSegment(i, { turnDeg: Number((e.currentTarget as HTMLInputElement).value) })}
					/>
				</div>
			{/each}
		</div>

		<div class="field">
			<button type="button" onclick={addSegment}>Add segment</button>
			<button type="button" onclick={removeLastSegment}>Remove last</button>
		</div>

		<div class="preview">
			<div class="kv">
				<div>Vertices</div>
				<div>{effectivePts.length}</div>
			</div>
			<div class="kv">
				<div>Closure error</div>
				<div>{Number.isFinite(err) ? err.toFixed(3) : '—'} mm</div>
			</div>

			<div class="shape-preview">
				<svg
					class="shape-svg"
					viewBox={`${previewBox.x} ${previewBox.y} ${previewBox.w} ${previewBox.h}`}
					preserveAspectRatio="xMidYMid meet"
					aria-label="Shape preview"
				>
					<!-- background -->
					<rect x={previewBox.x} y={previewBox.y} width={previewBox.w} height={previewBox.h} fill="rgba(148,163,184,0.05)" />

					{#if effectivePts.length >= 3 && err <= closeToleranceMm}
						<polygon
							points={effectivePts.map((p) => `${p.x},${p.y}`).join(' ')}
							fill="rgba(59,130,246,0.18)"
							stroke="rgba(59,130,246,0.85)"
							stroke-width="2"
						/>
					{:else}
						<polyline
							points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
							fill="none"
							stroke="rgba(226,232,240,0.7)"
							stroke-width="2"
							stroke-dasharray="6 4"
						/>
					{/if}

					{#if pts.length > 0}
						<!-- start point -->
						<circle cx={pts[0].x} cy={pts[0].y} r="4" fill="rgba(34,197,94,0.9)" />
						<!-- current end point -->
						<circle
							cx={pts[pts.length - 1].x}
							cy={pts[pts.length - 1].y}
							r="4"
							fill={err <= closeToleranceMm ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)'}
						/>
					{/if}
				</svg>
				<p class="hint tiny">
					Green dot = start. Red dot = current end (not closed).
				</p>
			</div>

			{#if requireClosed && err > closeToleranceMm}
				<p class="error">
					Shape is not closed within tolerance. Add more segments or adjust lengths/angles.
				</p>
			{/if}
		</div>

		<footer class="actions">
			<button type="button" onclick={onCancel}>Cancel</button>
			<button type="button" onclick={onSubmit} disabled={!createEnabled}>Create shape</button>
		</footer>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(2, 6, 23, 0.6);
		display: grid;
		place-items: center;
		padding: 20px;
		z-index: 50;
	}

	.dialog {
		width: min(900px, 100%);
		max-height: min(90vh, 900px);
		overflow: auto;
		background: rgba(2, 6, 23, 0.98);
		border: 1px solid rgba(148, 163, 184, 0.25);
		border-radius: 12px;
		padding: 14px;
		color: #e2e8f0;
	}

	h2 {
		margin: 0;
		font-size: 16px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(226, 232, 240, 0.85);
	}

	h3 {
		margin: 16px 0 8px;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(226, 232, 240, 0.8);
	}

	.hint {
		margin: 8px 0 0;
		color: rgba(226, 232, 240, 0.7);
		font-size: 12px;
		line-height: 1.4;
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin-top: 12px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		color: rgba(226, 232, 240, 0.8);
	}

	label.inline {
		flex-direction: row;
		align-items: center;
		gap: 8px;
	}

	.options {
		margin-top: 10px;
		display: flex;
		gap: 14px;
		flex-wrap: wrap;
		align-items: center;
	}

	input {
		background: rgba(148, 163, 184, 0.08);
		border: 1px solid rgba(148, 163, 184, 0.25);
		border-radius: 8px;
		padding: 6px 10px;
		color: inherit;
	}

	.segments {
		margin-top: 10px;
		display: grid;
		gap: 6px;
	}

	.row {
		display: grid;
		grid-template-columns: 40px 1fr 1fr;
		gap: 8px;
		align-items: center;
	}

	.row.header {
		color: rgba(226, 232, 240, 0.7);
		font-size: 12px;
	}

	.row > div {
		font-size: 12px;
		color: rgba(226, 232, 240, 0.8);
	}

	.field {
		margin-top: 12px;
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: end;
	}

	.preview {
		margin-top: 12px;
		padding-top: 10px;
		border-top: 1px solid rgba(148, 163, 184, 0.15);
	}

	.shape-preview {
		margin-top: 10px;
	}

	.shape-svg {
		width: 100%;
		height: 220px;
		display: block;
		border: 1px solid rgba(148, 163, 184, 0.18);
		border-radius: 10px;
	}

	.tiny {
		margin-top: 6px;
		font-size: 11px;
	}

	.kv {
		display: flex;
		justify-content: space-between;
		padding: 6px 0;
		border-bottom: 1px solid rgba(148, 163, 184, 0.15);
	}

	.error {
		margin-top: 10px;
		color: #fecaca;
		font-size: 12px;
	}

	.actions {
		margin-top: 12px;
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	button {
		background: rgba(148, 163, 184, 0.15);
		border: 1px solid rgba(148, 163, 184, 0.25);
		color: inherit;
		padding: 6px 10px;
		border-radius: 8px;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
