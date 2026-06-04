import { create } from "fontkit";
//#region src/engine/textNormalization.ts
var WORD_TEXT_FORMAT_CONTROL_RANGES = [
	[0, 31],
	[127, 159],
	[8234, 8238],
	[8288, 8303]
];
var WORD_TEXT_FORMAT_CONTROLS = new Set([
	173,
	847,
	1564,
	6158,
	8203,
	8206,
	8207,
	65279
]);
var WORD_TEXT_VARIATION_SELECTOR_RANGES = [[65024, 65039], [917760, 917999]];
var WORD_TEXT_SPACE_RE = /\s+/g;
function isCodePointInRanges(codePoint, ranges) {
	return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}
function removeWordTextControls(value, preserveVariationSelectors) {
	return Array.from(value).filter((char) => {
		const codePoint = char.codePointAt(0);
		if (codePoint === void 0) return false;
		if (WORD_TEXT_FORMAT_CONTROLS.has(codePoint)) return false;
		if (isCodePointInRanges(codePoint, WORD_TEXT_FORMAT_CONTROL_RANGES)) return false;
		if (!preserveVariationSelectors && isCodePointInRanges(codePoint, WORD_TEXT_VARIATION_SELECTOR_RANGES)) return false;
		return true;
	}).join("");
}
function normalizeWordText(value, options = {}) {
	return removeWordTextControls(value.normalize("NFKC"), options.preserveVariationSelectors === true).replace(WORD_TEXT_SPACE_RE, " ").trim();
}
//#endregion
//#region src/engine/outlineWordGeometry.ts
var GOOGLE_FONTS_CSS_URL = "https://fonts.googleapis.com/css2";
var DEFAULT_FEATURES = [
	"ccmp",
	"kern",
	"liga",
	"ltrm",
	"ltra",
	"rtla",
	"rtlm"
];
var MAX_FONT_SET_CACHE_ENTRIES = 192;
var MAX_OUTLINE_GEOMETRY_CACHE_ENTRIES = 4096;
var MAX_GLYPH_RUN_CACHE_ENTRIES = 4096;
var outlineFontSetCache = /* @__PURE__ */ new Map();
var outlineGeometryCache = /* @__PURE__ */ new Map();
var glyphRunCache = /* @__PURE__ */ new Map();
function uniqueText(text) {
	return Array.from(new Set(Array.from(text))).join("");
}
function toNumericWeight(weight) {
	const numeric = Number(weight);
	if (Number.isFinite(numeric) && numeric > 0) return numeric;
	if (weight === "bold") return 700;
	return 400;
}
function fontSetCacheKey(input) {
	const subset = uniqueText(input.text ?? "");
	const assetKey = (input.assets ?? []).map((asset) => `${asset.url}|${asset.weight}|${asset.style}|${asset.unicodeRange ?? ""}`).join(";");
	return [
		input.family.trim(),
		toNumericWeight(input.weight),
		input.style ?? "normal",
		input.sourceUrl ?? "",
		input.format ?? "",
		assetKey,
		subset
	].join("|");
}
function rememberCachedOutlineFontSet(key, value) {
	if (outlineFontSetCache.has(key)) outlineFontSetCache.delete(key);
	outlineFontSetCache.set(key, value);
	while (outlineFontSetCache.size > MAX_FONT_SET_CACHE_ENTRIES) {
		const oldestKey = outlineFontSetCache.keys().next().value;
		if (!oldestKey) break;
		outlineFontSetCache.delete(oldestKey);
	}
}
function rememberCachedOutlineGeometry(key, value) {
	if (outlineGeometryCache.has(key)) outlineGeometryCache.delete(key);
	outlineGeometryCache.set(key, value);
	while (outlineGeometryCache.size > MAX_OUTLINE_GEOMETRY_CACHE_ENTRIES) {
		const oldestKey = outlineGeometryCache.keys().next().value;
		if (!oldestKey) break;
		outlineGeometryCache.delete(oldestKey);
	}
}
function parseUnicodeRangeItem(range) {
	const match = range.trim().match(/^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i);
	if (!match) return null;
	const [, startRaw, endRaw] = match;
	if (startRaw.includes("?")) {
		const start = Number.parseInt(startRaw.replace(/\?/g, "0"), 16);
		const end = Number.parseInt(startRaw.replace(/\?/g, "F"), 16);
		return Number.isFinite(start) && Number.isFinite(end) ? [start, end] : null;
	}
	const start = Number.parseInt(startRaw, 16);
	const end = endRaw ? Number.parseInt(endRaw, 16) : start;
	return Number.isFinite(start) && Number.isFinite(end) ? [start, end] : null;
}
function parseUnicodeRanges(unicodeRange) {
	if (!unicodeRange) return [];
	return unicodeRange.split(",").map(parseUnicodeRangeItem).filter((range) => Boolean(range));
}
function assetCoversCodePoint(asset, codePoint) {
	const ranges = parseUnicodeRanges(asset.unicodeRange);
	if (ranges.length === 0) return true;
	return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}
function fontAssetsCoverText(assets, text) {
	const candidates = (assets ?? []).filter(Boolean);
	if (candidates.length === 0) return false;
	const codePoints = Array.from(new Set(Array.from(text).filter((char) => !/\s/.test(char)).map((char) => char.codePointAt(0)).filter((codePoint) => codePoint !== void 0)));
	if (codePoints.length === 0) return true;
	return codePoints.every((codePoint) => candidates.some((asset) => assetCoversCodePoint(asset, codePoint)));
}
function pickFontAssetBlocks(assets, text) {
	const candidates = (assets ?? []).filter(Boolean);
	if (candidates.length <= 1) return candidates;
	const selected = [];
	const seen = /* @__PURE__ */ new Set();
	const addAsset = (asset) => {
		const key = `${asset.url}|${asset.weight}|${asset.style}|${asset.unicodeRange ?? ""}`;
		if (seen.has(key)) return;
		seen.add(key);
		selected.push(asset);
	};
	const chars = Array.from(text);
	candidates.filter((asset) => !asset.unicodeRange).forEach(addAsset);
	for (const char of chars) {
		if (/\s/.test(char)) continue;
		const codePoint = char.codePointAt(0);
		if (codePoint === void 0) continue;
		const asset = candidates.find((candidate) => assetCoversCodePoint(candidate, codePoint));
		if (asset) addAsset(asset);
	}
	return selected.length > 0 ? selected : candidates;
}
function buildGoogleCssUrl(input) {
	const url = new URL(GOOGLE_FONTS_CSS_URL);
	const weight = toNumericWeight(input.weight);
	const style = input.style ?? "normal";
	const axis = style === "italic" ? "ital,wght" : "wght";
	const value = style === "italic" ? `1,${weight}` : String(weight);
	url.searchParams.set("family", `${input.family.trim()}:${axis}@${value}`);
	url.searchParams.set("display", "swap");
	const subset = uniqueText(input.text ?? "");
	if (subset) url.searchParams.set("text", subset);
	return url.toString();
}
function parseFontFaceBlocks(css) {
	return Array.from(css.matchAll(/@font-face\s*{([^}]+)}/g)).flatMap((match) => {
		const block = match[1];
		const rawUrl = block.match(/url\(([^)]+)\)/)?.[1];
		if (!rawUrl) return [];
		return [{
			url: rawUrl.replace(/^["']|["']$/g, ""),
			format: block.match(/format\(["']?([^"')]+)["']?\)/)?.[1],
			unicodeRange: block.match(/unicode-range:\s*([^;]+)/)?.[1]?.trim(),
			style: block.match(/font-style:\s*([^;]+)/)?.[1]?.trim() || "normal",
			weight: block.match(/font-weight:\s*([^;]+)/)?.[1]?.trim() || "400"
		}];
	});
}
function isFontCollection(value) {
	return !("unitsPerEm" in value);
}
function createFontFromBytes(bytes) {
	const view = new Uint8Array(bytes);
	const parsed = create(typeof Buffer === "undefined" ? view : Buffer.from(view));
	if (isFontCollection(parsed)) {
		const firstFont = parsed.fonts[0];
		if (!firstFont) throw new Error("Font collection does not contain fonts");
		return firstFont;
	}
	return parsed;
}
function getUsableUnitsPerEm(font) {
	try {
		const unitsPerEm = font.unitsPerEm;
		if (!Number.isFinite(unitsPerEm) || unitsPerEm <= 0) throw new Error(`Unable to read unitsPerEm for ${font.fullName || font.postscriptName}`);
		return unitsPerEm;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`Unable to read unitsPerEm for ${font.fullName || font.postscriptName}: ${reason}`);
	}
}
function applyVariationWeight(font, weight) {
	const weightAxis = font.variationAxes?.wght;
	if (!weightAxis) return font;
	try {
		const clampedWeight = Math.max(weightAxis.min, Math.min(weightAxis.max, weight));
		const variedFont = font.getVariation({ wght: clampedWeight });
		if (!Number.isFinite(variedFont.unitsPerEm) || variedFont.unitsPerEm <= 0) return font;
		return variedFont;
	} catch {
		return font;
	}
}
async function loadOutlineFontFace(sourceUrl, format, weight, signal) {
	const font = applyVariationWeight(createFontFromBytes(await fetch(sourceUrl, { signal }).then((response) => {
		if (!response.ok) throw new Error(`Font binary failed with ${response.status}`);
		return response.arrayBuffer();
	})), weight);
	return {
		key: `${sourceUrl}|${weight}`,
		sourceUrl,
		format,
		font,
		unitsPerEm: getUsableUnitsPerEm(font),
		characterSet: new Set(font.characterSet ?? [])
	};
}
function toBounds(bbox) {
	const xMin = Number.isFinite(bbox.minX) ? bbox.minX : 0;
	const yMin = Number.isFinite(bbox.minY) ? bbox.minY : 0;
	const xMax = Number.isFinite(bbox.maxX) ? bbox.maxX : xMin;
	const yMax = Number.isFinite(bbox.maxY) ? bbox.maxY : yMin;
	return {
		xMin,
		yMin,
		xMax,
		yMax,
		width: Math.max(0, xMax - xMin),
		height: Math.max(0, yMax - yMin)
	};
}
function emptyBounds() {
	return {
		xMin: 0,
		yMin: 0,
		xMax: 0,
		yMax: 0,
		width: 0,
		height: 0
	};
}
function mergeBounds(bounds) {
	const visibleBounds = bounds.filter((bound) => bound.width > 0 || bound.height > 0);
	if (visibleBounds.length === 0) return emptyBounds();
	const xMin = Math.min(...visibleBounds.map((bound) => bound.xMin));
	const yMin = Math.min(...visibleBounds.map((bound) => bound.yMin));
	const xMax = Math.max(...visibleBounds.map((bound) => bound.xMax));
	const yMax = Math.max(...visibleBounds.map((bound) => bound.yMax));
	return {
		xMin,
		yMin,
		xMax,
		yMax,
		width: xMax - xMin,
		height: yMax - yMin
	};
}
function translateBounds(bounds, dx, dy) {
	return {
		xMin: bounds.xMin + dx,
		yMin: bounds.yMin + dy,
		xMax: bounds.xMax + dx,
		yMax: bounds.yMax + dy,
		width: bounds.width,
		height: bounds.height
	};
}
function toOutlineBounds(bounds) {
	return {
		x: bounds.xMin,
		y: bounds.yMin,
		width: bounds.width,
		height: bounds.height
	};
}
function faceSupportsCodePoint(face, codePoint) {
	try {
		return face.font.hasGlyphForCodePoint(codePoint);
	} catch {
		return face.characterSet.has(codePoint);
	}
}
function missingCodePoints(faces, text) {
	const missing = [];
	const seen = /* @__PURE__ */ new Set();
	for (const char of Array.from(text)) {
		const codePoint = char.codePointAt(0);
		if (codePoint === void 0 || seen.has(codePoint)) continue;
		seen.add(codePoint);
		if (!faces.some((face) => faceSupportsCodePoint(face, codePoint))) missing.push(codePoint);
	}
	return missing;
}
function pickFaceForChar(char, faces, previousFace) {
	const codePoint = char.codePointAt(0);
	if (codePoint === void 0) return previousFace ?? faces[0] ?? null;
	if (/\s/.test(char)) return previousFace ?? faces[0] ?? null;
	return faces.find((face) => faceSupportsCodePoint(face, codePoint)) ?? null;
}
function getGlyphRun(face, text) {
	const key = `${face.key} ${text}`;
	const cached = glyphRunCache.get(key);
	if (cached) {
		glyphRunCache.delete(key);
		glyphRunCache.set(key, cached);
		return cached;
	}
	const run = face.font.layout(text, DEFAULT_FEATURES);
	glyphRunCache.set(key, run);
	while (glyphRunCache.size > MAX_GLYPH_RUN_CACHE_ENTRIES) {
		const oldestKey = glyphRunCache.keys().next().value;
		if (!oldestKey) break;
		glyphRunCache.delete(oldestKey);
	}
	return run;
}
function safeGlyphRun(face, text) {
	try {
		return getGlyphRun(face, text);
	} catch {
		return null;
	}
}
function isMissingGlyph(glyph) {
	return glyph.id === 0;
}
function layoutGlyphPaths(face, text, sizePx, startX) {
	const scale = sizePx / Math.max(1, face.unitsPerEm);
	const fallbackAdvance = sizePx * .5;
	const glyphs = [];
	let penX = startX;
	let skippedGlyphs = 0;
	const emitRun = (run) => {
		for (let index = 0; index < run.glyphs.length; index++) {
			const glyph = run.glyphs[index];
			const position = run.positions[index];
			if (!glyph || !position) continue;
			try {
				const advanceX = position.xAdvance * scale;
				if (isMissingGlyph(glyph)) {
					skippedGlyphs++;
					penX += Math.max(advanceX, fallbackAdvance);
					continue;
				}
				const path = buildGlyphPath(glyph, position, penX, scale);
				glyphs.push({
					path,
					bounds: toBounds(path.bbox),
					advanceX
				});
				penX += advanceX;
			} catch {
				skippedGlyphs++;
				penX += fallbackAdvance;
			}
		}
	};
	const run = safeGlyphRun(face, text);
	if (run) emitRun(run);
	else for (const char of Array.from(text)) {
		const charRun = safeGlyphRun(face, char);
		if (charRun) emitRun(charRun);
		else {
			skippedGlyphs++;
			penX += fallbackAdvance;
		}
	}
	return {
		glyphs,
		advanceWidth: penX - startX,
		skippedGlyphs
	};
}
function buildGlyphPath(glyph, position, penX, scale) {
	const originX = penX + position.xOffset * scale;
	const originY = -position.yOffset * scale;
	return glyph.path.transform(scale, 0, 0, -scale, originX, originY);
}
async function loadOutlineFontSet(input) {
	input = {
		...input,
		text: normalizeWordText(input.text ?? "")
	};
	const cacheKey = fontSetCacheKey(input);
	const cached = outlineFontSetCache.get(cacheKey);
	if (cached) return cached;
	const promise = (async () => {
		const weight = toNumericWeight(input.weight);
		let faces = [];
		if (input.assets?.length) {
			if (!fontAssetsCoverText(input.assets, input.text)) throw new Error(`No local outline assets cover text for ${input.family}`);
			try {
				const selectedAssets = pickFontAssetBlocks(input.assets, input.text);
				faces = await Promise.all(selectedAssets.map((asset) => loadOutlineFontFace(asset.url, asset.format, weight, input.signal)));
			} catch {
				const blocks = parseFontFaceBlocks(await fetch(buildGoogleCssUrl(input), { signal: input.signal }).then((response) => {
					if (!response.ok) throw new Error(`Google Fonts CSS failed with ${response.status}`);
					return response.text();
				})).filter((block) => block.style === (input.style ?? "normal"));
				faces = await Promise.all(blocks.map((block) => loadOutlineFontFace(block.url, block.format, weight, input.signal)));
			}
		} else {
			const blocks = parseFontFaceBlocks(await fetch(buildGoogleCssUrl(input), { signal: input.signal }).then((response) => {
				if (!response.ok) throw new Error(`Google Fonts CSS failed with ${response.status}`);
				return response.text();
			})).filter((block) => block.style === (input.style ?? "normal"));
			faces = await Promise.all(blocks.map((block) => loadOutlineFontFace(block.url, block.format, weight, input.signal)));
		}
		if (faces.length === 0) throw new Error(`No outline faces available for ${input.family}`);
		return {
			key: cacheKey,
			family: input.family,
			faces,
			defaultFace: faces[0]
		};
	})();
	rememberCachedOutlineFontSet(cacheKey, promise);
	return promise;
}
function layoutWordOutlineGeometry(fontSet, text, sizePx, curve = 0) {
	text = normalizeWordText(text);
	const normalizedText = text.trim();
	const roundedSize = Math.max(1, Math.round(sizePx));
	if (!normalizedText) return null;
	const cacheKey = `${fontSet.key}|${normalizedText}|${roundedSize}|${Math.round(curve)}`;
	if (outlineGeometryCache.has(cacheKey)) {
		const cached = outlineGeometryCache.get(cacheKey) ?? null;
		if (cached) rememberCachedOutlineGeometry(cacheKey, cached);
		return cached;
	}
	const segments = [];
	let currentFace = null;
	for (const char of Array.from(text)) {
		const face = pickFaceForChar(char, fontSet.faces, currentFace);
		if (!face) continue;
		if (segments.length === 0 || segments[segments.length - 1].face.key !== face.key) segments.push({
			face,
			text: char
		});
		else segments[segments.length - 1].text += char;
		currentFace = face;
	}
	if (segments.length === 0) {
		rememberCachedOutlineGeometry(cacheKey, null);
		return null;
	}
	const glyphs = [];
	let advanceWidth = 0;
	let skippedGlyphs = 0;
	for (const segment of segments) {
		const positioned = layoutGlyphPaths(segment.face, segment.text, roundedSize, advanceWidth);
		glyphs.push(...positioned.glyphs);
		advanceWidth += positioned.advanceWidth;
		skippedGlyphs += positioned.skippedGlyphs;
	}
	if (glyphs.length === 0 || skippedGlyphs > 0) {
		rememberCachedOutlineGeometry(cacheKey, null);
		return null;
	}
	let transformedGlyphs = glyphs.map((glyph) => ({
		path: glyph.path.translate(-advanceWidth / 2, 0),
		bounds: translateBounds(glyph.bounds, -advanceWidth / 2, 0),
		advanceX: glyph.advanceX
	}));
	if (curve !== 0) {
		const layoutWidth = Math.max(advanceWidth, roundedSize);
		const halfLayoutWidth = Math.max(1, layoutWidth / 2);
		const amplitude = -(curve / 100) * Math.min(layoutWidth * .38, roundedSize * 5);
		let cursor = -advanceWidth / 2;
		transformedGlyphs = transformedGlyphs.map((glyph) => {
			const glyphCenterX = cursor + glyph.advanceX / 2;
			cursor += glyph.advanceX;
			const normalized = glyphCenterX / halfLayoutWidth;
			const y = amplitude * (1 - normalized * normalized);
			const slope = amplitude * (-2 * glyphCenterX / (halfLayoutWidth * halfLayoutWidth));
			const angle = Math.atan(slope);
			const centerX = (glyph.bounds.xMin + glyph.bounds.xMax) / 2;
			const centerY = (glyph.bounds.yMin + glyph.bounds.yMax) / 2;
			const path = glyph.path.translate(-centerX, -centerY).rotate(angle).translate(centerX, centerY + y);
			return {
				path,
				bounds: toBounds(path.bbox),
				advanceX: glyph.advanceX
			};
		});
	}
	const mergedBounds = mergeBounds(transformedGlyphs.map((glyph) => glyph.bounds));
	const centerX = (mergedBounds.xMin + mergedBounds.xMax) / 2;
	const centerY = (mergedBounds.yMin + mergedBounds.yMax) / 2;
	const centeredGlyphs = transformedGlyphs.map((glyph) => ({
		path: glyph.path.translate(-centerX, -centerY),
		bounds: translateBounds(glyph.bounds, -centerX, -centerY)
	}));
	const centeredBounds = {
		x: mergedBounds.xMin - centerX,
		y: mergedBounds.yMin - centerY,
		width: mergedBounds.width,
		height: mergedBounds.height
	};
	const missing = missingCodePoints(fontSet.faces, text);
	if (missing.length > 0) {
		rememberCachedOutlineGeometry(cacheKey, null);
		return null;
	}
	const result = {
		path: centeredGlyphs.map((glyph) => glyph.path.toSVG()).join(" "),
		glyphs: centeredGlyphs.map((glyph) => ({
			path: glyph.path.toSVG(),
			bounds: toOutlineBounds(glyph.bounds)
		})),
		bounds: centeredBounds,
		baseSize: roundedSize,
		missingCodePoints: missing
	};
	rememberCachedOutlineGeometry(cacheKey, result);
	return result;
}
//#endregion
export { loadOutlineFontSet as n, normalizeWordText as r, layoutWordOutlineGeometry as t };
