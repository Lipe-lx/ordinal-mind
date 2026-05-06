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
