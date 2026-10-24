import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#141414"/><circle cx="423" cy="568" r="156" fill="#E6E6E6"/><circle cx="595" cy="421" r="132" fill="#141414" stroke="#E6E6E6" stroke-width="35"/></svg>`;
writeFileSync(new URL('../assets/icon.png', import.meta.url), new Resvg(svg).render().asPng());
