import { expect, test, type Page, type Route } from "@playwright/test"
import { addressFixture, chronicleFixture, scanProgressFixture, wikiGraphFixture } from "./fixtures"

async function fulfillChronicle(route: Route) {
  const url = new URL(route.request().url())
  const stream = url.searchParams.get("stream")
  const id = url.searchParams.get("id")
  const cursor = url.searchParams.get("cursor")

    if (stream === "1") {
      const body = [
      `event: progress\ndata: ${JSON.stringify(scanProgressFixture)}\n\n`,
      `event: result\ndata: ${JSON.stringify(chronicleFixture)}\n\n`,
    ].join("")

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body,
      headers: {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
    return
  }

  if (cursor !== null || id?.startsWith("bc1pfixtureaddress")) {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(addressFixture),
    })
    return
  }

  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(chronicleFixture),
  })
}

async function installApiMocks(page: Page, options?: { delayStreamMs?: number }) {
  await page.route("**/api/chronicle**", async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get("stream") === "1" && options?.delayStreamMs) {
      await page.waitForTimeout(options.delayStreamMs)
    }
    await fulfillChronicle(route)
  })

  await page.route("**/api/wiki/collection/**/graph**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: wikiGraphFixture,
      }),
    })
  })

  await page.route("**/api/wiki/export", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/zip",
      headers: {
        "Content-Disposition": `attachment; filename="ordinal-mind-wiki-export-2026-05-06.zip"`,
      },
      body: "fake-zip",
    })
  })
}

function buildIdentityToken(payload: Record<string, unknown>) {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
  const sig = btoa("sig").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
  return `${header}.${body}.${sig}`
}

async function installIdentityMocks(page: Page) {
  const token = buildIdentityToken({
    sub: "discord-id-1",
    username: "collector42",
    avatar: null,
    tier: "og",
    iat: 1700000000,
    exp: 4102444800,
  })

  await page.addInitScript((jwt) => {
    window.localStorage.setItem("ordinal-mind_discord_jwt", jwt)
    Object.defineProperty(window, "showSaveFilePicker", {
      value: undefined,
      configurable: true,
    })
  }, token)

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        user: {
          discordId: "discord-id-1",
          username: "collector42",
          avatar: null,
          tier: "og",
          badges: [],
        },
      }),
    })
  })
}

async function expectNoHorizontalOverflow(page: Page) {
  const hasOverflow = await page.evaluate(() => {
    const doc = document.documentElement
    return doc.scrollWidth > window.innerWidth + 1
  })

  expect(hasOverflow).toBe(false)
}

async function settlePage(page: Page) {
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(350)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    document.documentElement.dataset.uiTest = "true"
  })
  await page.emulateMedia({ reducedMotion: "reduce" })
})

test("home visual baseline", async ({ page }) => {
  await installApiMocks(page)
  await page.goto("/")
  await settlePage(page)
  await expect(page).toHaveScreenshot("home.png", { fullPage: true, animations: "disabled" })
  await expectNoHorizontalOverflow(page)
})

test("chronicle loading visual baseline", async ({ page }) => {
  await installApiMocks(page, { delayStreamMs: 900 })
  await page.goto("/chronicle/7")
  await expect(page.getByText("Initializing Engine")).toBeVisible()
  await page.waitForTimeout(200)
  await expect(page).toHaveScreenshot("chronicle-loading.png", { fullPage: true, animations: "disabled" })
  await expectNoHorizontalOverflow(page)
})

test("chronicle loaded visual baseline", async ({ page }) => {
  await installApiMocks(page)
  await page.goto("/chronicle/7")
  await expect(page.getByRole("heading", { name: /Runestone/i })).toBeVisible()
  await settlePage(page)
  await page.waitForTimeout(2200)
  const screenshot = await page.screenshot({ fullPage: true, animations: "disabled" })
  expect(screenshot).toMatchSnapshot("chronicle-loaded.png")
  await expectNoHorizontalOverflow(page)
})

test("address visual baseline", async ({ page }) => {
  await installApiMocks(page)
  await page.goto(`/address/${encodeURIComponent(addressFixture.address)}`)
  await expect(page.getByText("#7")).toBeVisible()
  await settlePage(page)
  await expect(page).toHaveScreenshot("address.png", { fullPage: true, animations: "disabled" })
  await expectNoHorizontalOverflow(page)
})

test("byok modal visual baseline", async ({ page }) => {
  await installApiMocks(page)
  await page.goto("/")
  await page.getByLabel("Configuration").click()
  await expect(page.getByRole("heading", { name: "Configuration" })).toBeVisible()
  await settlePage(page)
  await expect(page).toHaveScreenshot("byok-modal.png", { fullPage: true, animations: "disabled" })
  await expectNoHorizontalOverflow(page)
})

test("identity wiki export is enabled for authenticated users and prevents double click", async ({ page }) => {
  let exportRequests = 0

  await installIdentityMocks(page)
  await installApiMocks(page)
  await page.route("**/api/wiki/export", async (route) => {
    exportRequests += 1
    await page.waitForTimeout(250)
    await route.fulfill({
      status: 200,
      contentType: "application/zip",
      headers: {
        "Content-Disposition": `attachment; filename="ordinal-mind-wiki-export-2026-05-06.zip"`,
      },
      body: "fake-zip",
    })
  })

  await page.goto("/")
  await page.locator('[title="collector42 (og)"]').click()
  await page.getByRole("button", { name: "Public Wiki Export" }).click()
  const exportButton = page.locator("#wiki-export-btn")
  await expect(exportButton).toBeEnabled()

  await exportButton.click()
  await expect(exportButton).toBeDisabled()
  await exportButton.click({ force: true })

  await expect(page.getByText("Saved ordinal-mind-wiki-export-2026-05-06.zip")).toBeVisible()
  expect(exportRequests).toBe(1)
  await expectNoHorizontalOverflow(page)
})

test("wiki graph modal visual baseline", async ({ page }) => {
  await installApiMocks(page)
  await page.goto("/chronicle/7")
  await expect(page.getByRole("heading", { name: /Runestone/i })).toBeVisible()
  await page.getByTitle("Open collection wiki atlas").click()
  await expect(page.getByRole("heading", { name: "Wiki Atlas" })).toBeVisible()
  await settlePage(page)
  await expect(page).toHaveScreenshot("wiki-graph-modal.png", { animations: "disabled" })
  await expectNoHorizontalOverflow(page)
})

test("core mobile-safe flows stay functional", async ({ page }) => {
  await installApiMocks(page)

  await page.goto("/")
  await page.getByLabel("Configuration").click()
  await expect(page.getByRole("heading", { name: "Configuration" })).toBeVisible()
  await page.locator(".byok-overlay").click({ position: { x: 8, y: 8 } })

  await page.getByPlaceholder("Inscription # · hex ID · bc1p address").fill("7")
  await page.getByRole("button", { name: "Trace the Chronicle" }).click()
  await expect(page).toHaveURL(/\/chronicle\/7/)
  await expect(page.getByRole("heading", { name: /Runestone/i })).toBeVisible()

  await page.getByRole("button", { name: /Genealogical Tree/i }).click()
  await expect(page.getByText(/Genealog/i).first()).toBeVisible()

  await page.getByTitle("Open collection wiki atlas").click()
  await expect(page.getByRole("heading", { name: "Wiki Atlas" })).toBeVisible()
  await page.keyboard.press("Escape")

  await page.goto(`/address/${encodeURIComponent(addressFixture.address)}`)
  await page.getByText("#7").click()
  await expect(page).toHaveURL(/\/chronicle\/rooti0/)
})
