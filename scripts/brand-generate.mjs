// Renders every raster brand asset from the SVG sources in static/, so a
// colour or wordmark change is one edit plus `npm run brand:generate`.
//
//   static/favicon.svg            -> favicon-16x16, favicon-32x32, icon-192, icon-512
//                                    (transparent: the cube's faces are punched out)
//   static/brand/mark.svg         -> apple-touch-icon (cube on the dark tile) and
//                                    brand/app-icon (cube on white, dark faces)
//   static/brand/github-header.svg, social-preview.svg -> same-named PNGs
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const DARK = '#0b0c0f';
const FACES = '#13151a';

const favicon = await readFile('static/favicon.svg', 'utf8');
const mark = await readFile('static/brand/mark.svg', 'utf8');

/** The mark's inner body (defs + paths), for re-placing on a tile. */
const markBody = mark
	.replace(/^[\s\S]*?<svg[^>]*>/, '')
	.replace(/<\/svg>\s*$/, '')
	.replace(/<title>[\s\S]*?<\/title>/, '')
	.replace(/<!--[\s\S]*?-->/g, '');

/** The cube centred on a square tile, filling `scale` of its width. */
function tile(size, background, scale, faces) {
	const inset = (64 / scale - 64) / 2;
	const view = 64 + inset * 2;
	const fill = faces ? `<path d="M32 15 18 23v17l14 8 14-8V23l-14-8Z" fill="${faces}"/>` : '';
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-inset} ${-inset} ${view} ${view}">
		<rect x="${-inset}" y="${-inset}" width="${view}" height="${view}" fill="${background}"/>
		${fill}${markBody}</svg>`;
}

const jobs = [
	...[16, 32].map((size) => [favicon, size, `static/favicon-${size}x${size}.png`]),
	...[192, 512].map((size) => [favicon, size, `static/icon-${size}.png`]),
	[tile(180, DARK, 0.72), 180, 'static/apple-touch-icon.png'],
	[tile(1254, '#ffffff', 0.66, FACES), 1254, 'static/brand/app-icon.png'],
	[
		await readFile('static/brand/github-header.svg', 'utf8'),
		null,
		'static/brand/github-header.png'
	],
	[
		await readFile('static/brand/social-preview.svg', 'utf8'),
		null,
		'static/brand/social-preview.png'
	]
];

for (const [svg, size, out] of jobs) {
	// Render dense for crisp edges, then land on the exact target: the square
	// size for icons, the SVG's own width/height for the banners.
	const width = size ?? Number(svg.match(/<svg[^>]*\swidth="(\d+)"/)?.[1]);
	const height = size ?? Number(svg.match(/<svg[^>]*\sheight="(\d+)"/)?.[1]);
	const image = sharp(Buffer.from(svg), { density: 384 }).resize(width, height);
	await image.png({ compressionLevel: 9 }).toFile(out);
	console.log(`wrote ${out}`);
}
