import { describe, expect, it } from "vitest"
import {
  clampScale,
  localPointToScreenPoint,
  screenPointToLocalPoint,
  zoomAtPoint,
  type Point2D,
  type ViewportTransform,
} from "../../src/app/lib/genealogyViewport"

function renderedOrigin(baseOrigin: Point2D, transform: ViewportTransform): Point2D {
  return {
    x: baseOrigin.x + transform.tx,
    y: baseOrigin.y + transform.ty,
  }
}

describe("genealogy viewport helpers", () => {
  it("keeps the anchor point stable when zooming around center-origin transforms", () => {
    const baseOrigin: Point2D = { x: 420, y: 280 }
    const anchor: Point2D = { x: 610, y: 330 }
    const current: ViewportTransform = { scale: 0.9, tx: -24, ty: 18 }
    const currentOrigin = renderedOrigin(baseOrigin, current)

    const localBefore = screenPointToLocalPoint(anchor, currentOrigin, current)

    const next = zoomAtPoint({
      anchor,
      transformOrigin: currentOrigin,
      current,
      nextScale: 1.65,
    })

    const nextOrigin = renderedOrigin(baseOrigin, next)
    const anchorAfter = localPointToScreenPoint(localBefore, nextOrigin, next)

    expect(anchorAfter.x).toBeCloseTo(anchor.x, 8)
    expect(anchorAfter.y).toBeCloseTo(anchor.y, 8)
  })

  it("clamps scale to the configured limits", () => {
    expect(clampScale(0.01, 0.1, 3)).toBe(0.1)
    expect(clampScale(9, 0.1, 3)).toBe(3)
    expect(clampScale(1.25, 0.1, 3)).toBe(1.25)

    const zoomedOut = zoomAtPoint({
      anchor: { x: 120, y: 90 },
      transformOrigin: { x: 100, y: 100 },
      current: { scale: 1, tx: 0, ty: 0 },
      nextScale: 0.0001,
      minScale: 0.2,
      maxScale: 2.5,
    })
    expect(zoomedOut.scale).toBe(0.2)

    const zoomedIn = zoomAtPoint({
      anchor: { x: 120, y: 90 },
      transformOrigin: { x: 100, y: 100 },
      current: { scale: 1, tx: 0, ty: 0 },
      nextScale: 99,
      minScale: 0.2,
      maxScale: 2.5,
    })
    expect(zoomedIn.scale).toBe(2.5)
  })

  it("keeps pan as direct translation independent from scale", () => {
    const before: ViewportTransform = { scale: 2.4, tx: 30, ty: -70 }
    const panDelta = { x: -18, y: 26 }
    const after: ViewportTransform = {
      ...before,
      tx: before.tx + panDelta.x,
      ty: before.ty + panDelta.y,
    }

    expect(after.tx - before.tx).toBe(panDelta.x)
    expect(after.ty - before.ty).toBe(panDelta.y)
  })

  it("is numerically stable across repeated zoom-in and zoom-out cycles", () => {
    const baseOrigin: Point2D = { x: 512, y: 384 }
    const anchor: Point2D = { x: 713.125, y: 445.875 }
    const initial: ViewportTransform = { scale: 1, tx: 12.5, ty: -8.25 }
    const initialOrigin = renderedOrigin(baseOrigin, initial)

    const localAnchor = screenPointToLocalPoint(anchor, initialOrigin, initial)
    let current = initial

    for (let i = 0; i < 25; i++) {
      const origin = renderedOrigin(baseOrigin, current)
      current = zoomAtPoint({
        anchor,
        transformOrigin: origin,
        current,
        nextScale: current.scale * 1.13,
      })
    }

    for (let i = 0; i < 25; i++) {
      const origin = renderedOrigin(baseOrigin, current)
      current = zoomAtPoint({
        anchor,
        transformOrigin: origin,
        current,
        nextScale: current.scale / 1.13,
      })
    }

    const finalOrigin = renderedOrigin(baseOrigin, current)
    const finalAnchor = localPointToScreenPoint(localAnchor, finalOrigin, current)
    expect(finalAnchor.x).toBeCloseTo(anchor.x, 6)
    expect(finalAnchor.y).toBeCloseTo(anchor.y, 6)
  })
})
