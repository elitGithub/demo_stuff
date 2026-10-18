import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { header, footer, templates } from './src/components.mjs';
import * as pages from './src/pages.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const output = join(root, 'public');
await mkdir(output, { recursive: true });
await cp(join(root, 'assets'), join(output, 'assets'), { recursive: true });
const versions = Object.fromEntries(await Promise.all(['styles.css', 'sandbox.js', 'dashboard-pagination.js', 'app.js', 'admin.js'].map(async file => [file, createHash('sha256').update(await readFile(join(root, 'assets', file))).digest('hex').slice(0, 10)])));
const routes = [
  ['index.html', 'Thoughtfully personal travel', 'Discover extraordinary places and thoughtful journeys with Elsewhere. Explore your next destination and imagine a journey made around you.', pages.home],
  ['destinations.html', 'Find your somewhere', 'Explore Italy, Japan, Bali, Tanzania, the Maldives and Greece. Find inspiration for a thoughtful, personal travel experience.', pages.destinationsPage],
  ['journeys.html', 'Journeys made around you', 'Browse six thoughtfully crafted sample travel itineraries. Filter by destination and travel style, explore the details and make a journey your own.', pages.journeysPage],
  ['about.html', 'The Elsewhere story', 'Discover the idea behind Elsewhere: thoughtful, unhurried travel shaped around your curiosity, with local perspectives and human connection.', pages.about],
  ['journal.html', 'Notes from Elsewhere', 'Travel stories, destination inspiration and thoughtful perspectives for the curious traveller. Step inside the Elsewhere journal.', pages.journal],
  ['contact.html', 'Let’s plan your journey', 'Tell us about your travel daydream. Explore the Elsewhere demo enquiry experience and start shaping a personal journey.', pages.contact],
  ['admin.html', 'Demo travel workspace', 'Explore saved demo enquiries and fictional bookings in the Elsewhere demonstration dashboard.', pages.admin]
];
for (const [file, title, description, content] of routes) {
  const scripts = [...(['contact.html', 'admin.html'].includes(file) ? ['sandbox.js'] : []), ...(file === 'admin.html' ? ['dashboard-pagination.js'] : []), 'app.js', ...(file === 'admin.html' ? ['admin.js'] : [])].map(asset => `<script src="assets/${asset}" defer></script>`).join('');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${description}"><meta name="theme-color" content="#223c33"><meta name="robots" content="noindex, nofollow"><meta property="og:title" content="${title} | Elsewhere"><meta property="og:description" content="${description}"><meta property="og:type" content="website"><meta property="og:image" content="assets/images/hero-lake.jpg"><title>${title} | Elsewhere</title><link rel="icon" href="assets/favicon.svg" type="image/svg+xml"><link rel="preload" href="assets/fonts/dm-serif.ttf" as="font" type="font/ttf" crossorigin><link rel="stylesheet" href="assets/styles.css">${scripts}</head><body data-page="${file.replace('.html', '')}">${header(file)}<main id="main">${content()}</main>${footer()}${file !== 'admin.html' ? templates() : ''}</body></html>`;
  const versioned = html.replace(/assets\/(styles\.css|sandbox\.js|dashboard-pagination\.js|app\.js|admin\.js)"/g, (_, asset) => `assets/${asset}?v=${versions[asset]}"`);
  await writeFile(join(output, file), versioned);
}
await writeFile(join(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log('Built 6 public pages and the demo dashboard in public/.');
