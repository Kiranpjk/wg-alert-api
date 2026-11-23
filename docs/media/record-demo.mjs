// Records the dashboard demo as a video with a real browser.
// Run:  npm i playwright-core && node docs/media/record-demo.mjs [url]
// Uses the system Chrome (override with CHROME_PATH). Output: docs/media/raw/*.webm
import { mkdirSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core')

const url = process.argv[2] ?? 'https://kiranpjk.github.io/wg-alert-api/'
const out = new URL('./raw/', import.meta.url).pathname
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable', headless: true })
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: out, size: { width: 1280, height: 720 } },
  colorScheme: 'light',
})
await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div')
    dot.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(180,65,31,.55);border:2px solid #fff;pointer-events:none;transition:transform .08s;left:-50px;top:-50px'
    const cap = document.createElement('div')
    cap.id = 'demo-caption'
    cap.style.cssText = 'position:fixed;z-index:99998;left:50%;bottom:22px;transform:translateX(-50%);max-width:80%;padding:10px 18px;border-radius:10px;background:#1B1A17;color:#F1EEE7;font:600 17px Inter,system-ui,sans-serif;opacity:0;transition:opacity .25s;pointer-events:none'
    document.body.append(dot, cap)
    addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px' }, true)
    addEventListener('mousedown', () => { dot.style.transform = 'scale(.7)' }, true)
    addEventListener('mouseup', () => { dot.style.transform = 'scale(1)' }, true)
  })
})
const page = await context.newPage()
const wait = (ms) => page.waitForTimeout(ms)
const caption = async (text) => { await page.evaluate((t) => { const c = document.getElementById('demo-caption'); c.textContent = t; c.style.opacity = t ? '1' : '0' }, text); await wait(300) }
const glide = async (loc) => { const box = await loc.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 }); await wait(250) }
const click = async (loc) => { await glide(loc); await loc.click() }
const type = async (loc, text) => { await click(loc); await loc.pressSequentially(text, { delay: 55 }) }

page.on('pageerror', (e) => console.error('page error:', e.message))
try {
await page.goto(url); await page.getByText('No searches yet').waitFor(); await wait(1200)
await caption('WG Alert: save a room search, then only see NEW matches'); await wait(2200)

await caption('1. Save a search'); 
await click(page.getByRole('main').getByRole('button', { name: 'New search' }))
const form = page.getByRole('dialog', { name: 'New search' })
await type(form.getByLabel('Search name'), 'Near campus')
await type(form.getByLabel('City'), 'Jena')
await type(form.getByLabel('Max. warm rent (€)'), '450')
await wait(500); await click(form.getByRole('button', { name: 'Save search' }))
await page.getByRole('article').first().waitFor(); await wait(1800)
await caption('A new search is matched against recent listings straight away'); await wait(2200)

await caption('2. More listings arrive from a feed (demo data)')
await click(page.getByRole('button', { name: 'Settings' }))
await click(page.getByRole('button', { name: 'Ingest sample feed' }))
await page.getByText(/created, .* duplicates/).waitFor(); await wait(1800)
await page.keyboard.press('Escape'); await wait(900)
await page.getByRole('article').first().waitFor(); await wait(1500)

await caption('3. Sort by lowest rent or best price per m²')
await glide(page.locator('select').first())
await page.locator('select').first().selectOption('rent'); await wait(1800)
await page.locator('select').first().selectOption('value'); await wait(1800)

await caption('4. Mark all seen: the next feed only shows what is new')
await click(page.getByRole('button', { name: 'Mark all seen' })); await wait(2000)

await caption('5. Paste a raw ad, review the draft, add it to the feed')
await click(page.locator('.add-ad-button'))
await type(page.getByLabel('Paste the ad'), 'WG-Zimmer in Jena-Lobeda, 18 m2, 340 EUR warm, frei ab 01.01.2027. Link: https://example.org/rooms/lobeda-77')
await wait(600); await click(page.getByRole('button', { name: 'Extract details' }))
await page.getByText('Review listing').waitFor(); await wait(2600)
await click(page.getByRole('button', { name: 'Add to feed' })); await wait(2200)
await page.keyboard.press('Escape'); await wait(900)

await caption('6. Light and dark theme'); 
await click(page.getByRole('button', { name: /Switch to dark theme/ })); await wait(2200)
await caption('Demo mode: data stays in your browser. Real stack: FastAPI + PostgreSQL + Docker, with CI'); await wait(3200)

} catch (error) {
  await page.screenshot({ path: out + 'failure.png' })
  console.error('FAILED:', error.message.split('\n')[0])
}
const video = page.video()
await context.close(); await browser.close()
console.log('video:', await video.path())
