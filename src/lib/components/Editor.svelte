<script lang="ts">
	import { get } from 'svelte/store';

	import { polygonAreaMm2 } from '$lib/floorplan/geometry';
	import type { CircleFurniture, Furniture, PolygonFurniture, RectFurniture, ToolMode } from '$lib/floorplan/models';
	import type { ReferenceImage } from '$lib/floorplan/models';
	import {
		addPolygonFurniture,
		duplicateFurniture,
		parsePlanJson,
		planStore,
		removeFurniture,
		removeReferenceImage,
		resetPlan,
		scaleRoomsToTargetAreaM2,
		setReferenceImage,
		toggleFurnitureHidden,
		updateCircleFurniture,
		updatePolygonFurniture,
		updateRectFurniture,
		updateReferenceImage,
		setPlan
	} from '$lib/floorplan/stores/planStore';

	import CustomShapeDialog from './CustomShapeDialog.svelte';
	import PlanSvg from './PlanSvg.svelte';

	let tool: ToolMode = $state('select');
	let errorMsg: string | null = $state(null);

	let selectedFurnitureId: string | undefined = $state(undefined);
	let showCustomShapeDialog = $state(false);

	let newRectName = $state('Sofa');
	let newRectWidthMm = $state(800);
	let newRectHeightMm = $state(600);

	let fileInput: HTMLInputElement | null = null;
	let imageInput: HTMLInputElement | null = null;

	let targetAreaM2 = $state('');
	let lastScaleFactor: number | null = $state(null);

	function currentAreaM2(): number {
		return totalRoomAreaMm2() / 1_000_000;
	}

	function previewScaleFactor(targetM2: number): number | null {
		const cur = currentAreaM2();
		if (cur <= 0) return null;
		if (!Number.isFinite(targetM2) || targetM2 <= 0) return null;
		return Math.sqrt(targetM2 / cur);
	}

	function parseTargetAreaM2(v: unknown): number | null {
		if (typeof v === 'number') {
			if (!Number.isFinite(v)) return null;
			return v;
		}

		const s = String(v ?? '').trim();
		if (!s) return null;
		const n = Number(s.replace(',', '.'));
		if (!Number.isFinite(n)) return null;
		return n;
	}

	function onApplyScaleRooms() {
		errorMsg = null;
		lastScaleFactor = null;

		const target = parseTargetAreaM2(targetAreaM2);
		if (target === null || target <= 0) {
			errorMsg = 'Target area must be a number > 0';
			return;
		}

		try {
			const res = scaleRoomsToTargetAreaM2(target);
			lastScaleFactor = res.scale;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
		}
	}

	function totalRoomAreaMm2() {
		return $planStore.rooms.reduce((acc, r) => acc + polygonAreaMm2(r.polygon), 0);
	}

	function selectedFurniture(): Furniture | undefined {
		return $planStore.furniture.find((x) => x.id === selectedFurnitureId);
	}

	function updateSelectedName(name: string) {
		const sel = selectedFurniture();
		if (!sel) return;
		switch (sel.kind) {
			case 'rect':
				updateRectFurniture(sel.id, { name });
				return;
			case 'circle':
				updateCircleFurniture(sel.id, { name });
				return;
			case 'polygon':
				updatePolygonFurniture(sel.id, { name });
				return;
		}
	}

	function duplicateSelected() {
		const sel = selectedFurniture();
		if (!sel) return;
		try {
			const newId = duplicateFurniture(sel.id);
			selectedFurnitureId = newId;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
		}
	}

	function toggleHideSelected() {
		const sel = selectedFurniture();
		if (!sel) return;
		try {
			toggleFurnitureHidden(sel.id);
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
		}
	}

	function setCircleNumber(id: string, field: 'cx' | 'cy' | 'radiusMm', v: string) {
		const n = Number(v);
		if (!Number.isFinite(n)) return;
		if (field === 'radiusMm') {
			updateCircleFurniture(id, { radiusMm: Math.max(1, n) });
			return;
		}
		updateCircleFurniture(id, { [field]: n } as never);
	}

	function setPolygonNumber(id: string, field: 'rotationDeg', v: string) {
		const n = Number(v);
		if (!Number.isFinite(n)) return;
		const rot = ((n % 360) + 360) % 360;
		updatePolygonFurniture(id, { rotationDeg: rot });
	}

	function onCreateCustomShape(shape: { name: string; points: { x: number; y: number }[] }) {
		errorMsg = null;
		try {
			const id = addPolygonFurniture({ name: shape.name, points: shape.points, rotationDeg: 0 });
			selectedFurnitureId = id;
			tool = 'select';
			showCustomShapeDialog = false;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
		}
	}

	function setFurnitureNumber(
		id: string,
		field: 'x' | 'y' | 'widthMm' | 'heightMm' | 'rotationDeg',
		v: string
	) {
		const n = Number(v);
		if (!Number.isFinite(n)) return;

		if (field === 'widthMm' || field === 'heightMm') {
			updateRectFurniture(id, { [field]: Math.max(1, n) } as never);
			return;
		}

		if (field === 'rotationDeg') {
			// Normalize to [0, 360)
			const rot = ((n % 360) + 360) % 360;
			updateRectFurniture(id, { rotationDeg: rot });
			return;
		}

		updateRectFurniture(id, { [field]: n } as never);
	}

	function download(filename: string, text: string) {
		const blob = new Blob([text], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	function onExportJson() {
		errorMsg = null;
		download('floorplan.json', JSON.stringify(get(planStore), null, 2));
	}

	function onImportClick() {
		errorMsg = null;
		fileInput?.click();
	}

	async function onFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const text = await file.text();
			const parsed = parsePlanJson(text);
			setPlan(parsed);
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
		} finally {
			// Allow importing the same file again.
			input.value = '';
		}
	}

	function onImportImageClick() {
		errorMsg = null;
		imageInput?.click();
	}

	async function dataUrlFromFile(file: File): Promise<string> {
		return await new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
			reader.readAsDataURL(file);
		});
	}

	async function getImageAspect(dataUrl: string): Promise<number> {
		const img = new Image();
		img.src = dataUrl;
		await img.decode();
		if (img.naturalWidth <= 0 || img.naturalHeight <= 0)
			throw new Error('Image has invalid dimensions');
		return img.naturalHeight / img.naturalWidth;
	}

	async function onImageFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		try {
			errorMsg = null;
			const dataUrl = await dataUrlFromFile(file);
			const aspect = await getImageAspect(dataUrl);

			const widthMm = 10000;
			const heightMm = widthMm * aspect;

			const img: Omit<ReferenceImage, 'id'> = {
				dataUrl,
				x: -5000,
				y: -5000,
				widthMm,
				heightMm,
				aspect,
				opacity: 0.5
			};

			setReferenceImage(img);
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
		} finally {
			input.value = '';
		}
	}

	function setRefNumber(field: 'x' | 'y' | 'widthMm' | 'heightMm' | 'opacity', v: string) {
		const n = Number(v);
		if (!Number.isFinite(n)) return;

		if (field === 'widthMm' || field === 'heightMm') {
			const img = $planStore.referenceImage;
			if (!img) return;

			const aspect =
				img.aspect && Number.isFinite(img.aspect) && img.aspect > 0
					? img.aspect
					: img.widthMm > 0
						? img.heightMm / img.widthMm
						: null;

			if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return;

			if (field === 'widthMm') {
				const widthMm = Math.max(1, n);
				updateReferenceImage({ widthMm, heightMm: widthMm * aspect });
				return;
			}

			const heightMm = Math.max(1, n);
			updateReferenceImage({ heightMm, widthMm: heightMm / aspect });
			return;
		}

		updateReferenceImage({ [field]: n } as never);
	}
</script>

<div class="editor">
	<header class="topbar">
		<div class="left">
			<strong>Floorplanner</strong>
		</div>
		<div class="actions">
			<button type="button" onclick={() => (tool = 'select')} class:selected={tool === 'select'}
				>Select</button
			>
			<button type="button" onclick={() => (tool = 'pan')} class:selected={tool === 'pan'}
				>Pan</button
			>
			<button
				type="button"
				onclick={() => (tool = 'draw-wall')}
				class:selected={tool === 'draw-wall'}>Draw wall</button
			>
			<button
				type="button"
				onclick={() => (tool = 'draw-room')}
				class:selected={tool === 'draw-room'}>Draw room</button
			>
			<button
				type="button"
				onclick={() => (tool = 'place-rect')}
				class:selected={tool === 'place-rect'}>Place rect</button
			>
			<button
				type="button"
				onclick={() => (tool = 'scale-rooms')}
				class:selected={tool === 'scale-rooms'}>Scale rooms</button
			>

			<div class="sep"></div>

			<button type="button" onclick={() => resetPlan()}>New</button>
			<button type="button" onclick={onImportClick}>Import JSON</button>
			<button type="button" onclick={onExportJson}>Export JSON</button>
			<button type="button" onclick={onImportImageClick}>Import image</button>
			<input
				bind:this={fileInput}
				type="file"
				accept="application/json,.json"
				class="file"
				onchange={onFileChange}
			/>
			<input
				bind:this={imageInput}
				type="file"
				accept="image/*"
				class="file"
				onchange={onImageFileChange}
			/>
		</div>
	</header>

	<main class="main">
		<section class="canvas">
			<PlanSvg
				{tool}
				{selectedFurnitureId}
				rectDefaults={{ name: newRectName, widthMm: newRectWidthMm, heightMm: newRectHeightMm }}
				onSelectFurniture={(id) => (selectedFurnitureId = id)}
				onFurnitureCreated={(id) => {
					selectedFurnitureId = id;
					tool = 'select';
				}}
			/>
		</section>

		<aside class="panel">
			<h2>Stats</h2>
			<div class="kv">
				<div>Walls</div>
				<div>{$planStore.walls.length}</div>
			</div>
			<div class="kv">
				<div>Rooms</div>
				<div>{$planStore.rooms.length}</div>
			</div>
			<div class="kv">
				<div>Total area</div>
				<div>{(totalRoomAreaMm2() / 1_000_000).toFixed(2)} m²</div>
			</div>

			<h2>Furniture</h2>
			<div class="field">
				<label>
					New rect name
					<input type="text" bind:value={newRectName} />
				</label>
				<label>
					W (mm)
					<input type="number" min="1" step="10" bind:value={newRectWidthMm} />
				</label>
				<label>
					H (mm)
					<input type="number" min="1" step="10" bind:value={newRectHeightMm} />
				</label>
				<button type="button" onclick={() => (tool = 'place-rect')}>Place</button>
				<button type="button" onclick={() => (showCustomShapeDialog = true)}>Custom shape…</button>
			</div>

			{#if $planStore.furniture.length === 0}
				<p class="hint">No furniture yet. Use “Place rect”.</p>
			{:else}
				<ul class="list">
					{#each $planStore.furniture as f (f.id)}
						<li>
							<button
								type="button"
								class:selected={f.id === selectedFurnitureId}
								class:hidden={!!f.hidden}
								onclick={() => {
									selectedFurnitureId = f.id;
									tool = 'select';
								}}
							>
								{f.name} [{f.kind}]{f.hidden ? ' (hidden)' : ''}
							</button>
						</li>
					{/each}
				</ul>

				{@const sel = selectedFurniture()}
				{#if sel}
					<h2>Selected furniture</h2>

					<div class="grid">
						<label>
							Name
							<input
								type="text"
								value={sel.name}
								oninput={(e) => updateSelectedName((e.currentTarget as HTMLInputElement).value)}
							/>
						</label>

						{#if sel.kind === 'rect'}
							<label>
								X (mm)
								<input
									type="number"
									step="10"
									value={sel.x}
									oninput={(e) =>
										setFurnitureNumber(sel.id, 'x', (e.currentTarget as HTMLInputElement).value)}
								/>
							</label>
							<label>
								Y (mm)
								<input
									type="number"
									step="10"
									value={sel.y}
									oninput={(e) =>
										setFurnitureNumber(sel.id, 'y', (e.currentTarget as HTMLInputElement).value)}
								/>
							</label>
							<label>
								Width (mm)
								<input
									type="number"
									min="1"
									step="10"
									value={sel.widthMm}
									oninput={(e) =>
										setFurnitureNumber(
											sel.id,
											'widthMm',
											(e.currentTarget as HTMLInputElement).value
										)}
								/>
							</label>
							<label>
								Height (mm)
								<input
									type="number"
									min="1"
									step="10"
									value={sel.heightMm}
									oninput={(e) =>
										setFurnitureNumber(
											sel.id,
											'heightMm',
											(e.currentTarget as HTMLInputElement).value
										)}
								/>
							</label>
							<label>
								Rotation (°)
								<input
									type="number"
									step="1"
									value={sel.rotationDeg}
									oninput={(e) =>
										setFurnitureNumber(
											sel.id,
											'rotationDeg',
											(e.currentTarget as HTMLInputElement).value
										)}
								/>
							</label>
						{:else if sel.kind === 'circle'}
							<label>
								CX (mm)
								<input
									type="number"
									step="10"
									value={sel.cx}
									oninput={(e) => setCircleNumber(sel.id, 'cx', (e.currentTarget as HTMLInputElement).value)}
								/>
							</label>
							<label>
								CY (mm)
								<input
									type="number"
									step="10"
									value={sel.cy}
									oninput={(e) => setCircleNumber(sel.id, 'cy', (e.currentTarget as HTMLInputElement).value)}
								/>
							</label>
							<label>
								Radius (mm)
								<input
									type="number"
									min="1"
									step="10"
									value={sel.radiusMm}
									oninput={(e) =>
										setCircleNumber(sel.id, 'radiusMm', (e.currentTarget as HTMLInputElement).value)}
								/>
							</label>
						{:else}
							<label>
								Rotation (°)
								<input
									type="number"
									step="1"
									value={sel.rotationDeg}
									oninput={(e) =>
										setPolygonNumber(sel.id, 'rotationDeg', (e.currentTarget as HTMLInputElement).value)}
								/>
							</label>
							<label>
								Points
								<input type="text" value={String(sel.points.length)} disabled />
							</label>
						{/if}
					</div>

					<div class="field">
						<button type="button" onclick={duplicateSelected}>Duplicate</button>
						<button type="button" onclick={toggleHideSelected}>
							{sel.hidden ? 'Show' : 'Hide'}
						</button>
						<button
							type="button"
							onclick={() => {
								removeFurniture(sel.id);
								selectedFurnitureId = undefined;
							}}
						>
							Delete
						</button>
					</div>
				{/if}
			{/if}

			<h2>Background</h2>
			{#if $planStore.referenceImage}
				<div class="field">
					<label>
						Opacity
						<input
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={$planStore.referenceImage.opacity}
							oninput={(e) => setRefNumber('opacity', (e.currentTarget as HTMLInputElement).value)}
						/>
					</label>
					<button type="button" onclick={() => removeReferenceImage()}>Remove</button>
				</div>

				<div class="grid">
					<label>
						X (mm)
						<input
							type="number"
							step="10"
							value={$planStore.referenceImage.x}
							oninput={(e) => setRefNumber('x', (e.currentTarget as HTMLInputElement).value)}
						/>
					</label>
					<label>
						Y (mm)
						<input
							type="number"
							step="10"
							value={$planStore.referenceImage.y}
							oninput={(e) => setRefNumber('y', (e.currentTarget as HTMLInputElement).value)}
						/>
					</label>
					<label>
						Width (mm)
						<input
							type="number"
							min="1"
							step="10"
							value={$planStore.referenceImage.widthMm}
							oninput={(e) => setRefNumber('widthMm', (e.currentTarget as HTMLInputElement).value)}
						/>
					</label>
					<label>
						Height (mm)
						<input
							type="number"
							min="1"
							step="10"
							value={$planStore.referenceImage.heightMm}
							oninput={(e) => setRefNumber('heightMm', (e.currentTarget as HTMLInputElement).value)}
						/>
					</label>
				</div>
			{:else}
				<p class="hint">No background image. Use “Import image”.</p>
			{/if}

			{#if tool === 'scale-rooms'}
				<h2>Scale rooms</h2>
				<div class="field">
					<label>
						Target total area (m²)
						<input type="number" min="0" step="0.01" bind:value={targetAreaM2} />
					</label>
					<button type="button" onclick={onApplyScaleRooms}>Apply</button>
				</div>

				{@const parsedTarget = parseTargetAreaM2(targetAreaM2)}
				{#if parsedTarget !== null}
					{@const preview = previewScaleFactor(parsedTarget)}
					{#if preview}
						<p class="hint">Preview scale factor: {preview.toFixed(4)}×</p>
					{/if}
				{/if}

				{#if lastScaleFactor}
					<p class="hint">Applied scale: {lastScaleFactor.toFixed(4)}×</p>
				{/if}
			{/if}

			{#if errorMsg}
				<p class="error">{errorMsg}</p>
			{/if}

			{#if tool === 'pan'}
				<p class="hint">Pan/zoom: mouse wheel to zoom, Shift+drag (or Pan tool) to pan.</p>
			{:else if tool === 'draw-wall'}
				<p class="hint">
					Draw wall: click to add points. Enter = finish, Backspace = undo last, Esc = cancel. Hold
					Shift to pan.
				</p>
			{:else if tool === 'draw-room'}
				<p class="hint">
					Draw room (orthogonal): click to add vertices. Click the first point to close (must be
					axis-aligned). Enter = finish, Backspace = undo last, Esc = cancel.
				</p>
			{:else if tool === 'place-rect'}
				<p class="hint">
					Place rect: click on the canvas to place a rectangle with the size from the Furniture
					panel.
				</p>
			{:else if tool === 'scale-rooms'}
				<p class="hint">
					Scale rooms: enter a target total area (m²) and apply. This only scales room polygons
					(walls stay as-is).
				</p>
			{:else}
				<p class="hint">Tip: use Draw wall / Draw room to start building a plan.</p>
			{/if}
		</aside>
	</main>
</div>

{#if showCustomShapeDialog}
	<CustomShapeDialog onCancel={() => (showCustomShapeDialog = false)} onCreate={onCreateCustomShape} />
{/if}

<style>
	.editor {
		height: 100vh;
		display: flex;
		flex-direction: column;
		background: #0b1220;
		color: #e2e8f0;
		font-family:
			system-ui,
			-apple-system,
			Segoe UI,
			Roboto,
			sans-serif;
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border-bottom: 1px solid rgba(148, 163, 184, 0.25);
		background: rgba(2, 6, 23, 0.6);
		backdrop-filter: blur(10px);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.sep {
		width: 1px;
		height: 24px;
		background: rgba(148, 163, 184, 0.25);
		margin: 0 4px;
	}

	button {
		background: rgba(148, 163, 184, 0.15);
		border: 1px solid rgba(148, 163, 184, 0.25);
		color: inherit;
		padding: 6px 10px;
		border-radius: 8px;
		cursor: pointer;
	}

	button.selected {
		background: rgba(59, 130, 246, 0.25);
		border-color: rgba(59, 130, 246, 0.5);
	}

	.main {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr 360px;
		min-height: 0;
	}

	.canvas {
		min-height: 0;
	}

	.panel {
		border-left: 1px solid rgba(148, 163, 184, 0.25);
		padding: 12px;
		background: rgba(2, 6, 23, 0.6);
		min-height: 0;
		overflow: auto;
	}

	h2 {
		margin: 0 0 12px;
		font-size: 14px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(226, 232, 240, 0.8);
	}

	.kv {
		display: flex;
		justify-content: space-between;
		padding: 6px 0;
		border-bottom: 1px solid rgba(148, 163, 184, 0.15);
	}

	.error {
		margin-top: 12px;
		color: #fecaca;
	}

	.field {
		margin-top: 12px;
		display: flex;
		gap: 8px;
		align-items: end;
		flex-wrap: wrap;
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin-top: 10px;
	}

	ul.list {
		list-style: none;
		padding: 0;
		margin: 10px 0 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	ul.list button {
		width: 100%;
		text-align: left;
	}

	ul.list button.hidden {
		opacity: 0.65;
		text-decoration: line-through;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		color: rgba(226, 232, 240, 0.8);
	}

	input {
		background: rgba(148, 163, 184, 0.08);
		border: 1px solid rgba(148, 163, 184, 0.25);
		border-radius: 8px;
		padding: 6px 10px;
		color: inherit;
	}

	.hint {
		margin-top: 12px;
		color: rgba(226, 232, 240, 0.7);
		font-size: 12px;
	}

	.file {
		display: none;
	}
</style>
