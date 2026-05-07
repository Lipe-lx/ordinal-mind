export interface Point2D {
  x: number
  y: number
}

export interface ViewportTransform {
  scale: number
  tx: number
  ty: number
}

export interface ZoomAtPointArgs {
  anchor: Point2D
  transformOrigin: Point2D
  current: ViewportTransform
  nextScale: number
  minScale?: number
  maxScale?: number
}

export function clampScale(scale: number, minScale: number = 0.1, maxScale: number = 3): number {
  return Math.min(Math.max(scale, minScale), maxScale)
}

export function screenPointToLocalPoint(
  point: Point2D,
  transformOrigin: Point2D,
  transform: ViewportTransform
): Point2D {
  const safeScale = transform.scale === 0 ? 1 : transform.scale
  return {
    x: (point.x - transformOrigin.x) / safeScale,
    y: (point.y - transformOrigin.y) / safeScale,
  }
}

export function localPointToScreenPoint(
  localPoint: Point2D,
  transformOrigin: Point2D,
  transform: ViewportTransform
): Point2D {
  return {
    x: transformOrigin.x + localPoint.x * transform.scale,
    y: transformOrigin.y + localPoint.y * transform.scale,
  }
}

export function zoomAtPoint({
  anchor,
  transformOrigin,
  current,
  nextScale,
  minScale = 0.1,
  maxScale = 3,
}: ZoomAtPointArgs): ViewportTransform {
  const clampedScale = clampScale(nextScale, minScale, maxScale)
  const currentScale = current.scale

  if (!Number.isFinite(currentScale) || currentScale <= 0 || !Number.isFinite(clampedScale)) {
    return {
      scale: clampScale(currentScale, minScale, maxScale),
      tx: current.tx,
      ty: current.ty,
    }
  }

  if (clampedScale === currentScale) {
    return {
      scale: currentScale,
      tx: current.tx,
      ty: current.ty,
    }
  }

  const ratio = clampedScale / currentScale
  const dx = anchor.x - transformOrigin.x
  const dy = anchor.y - transformOrigin.y

  return {
    scale: clampedScale,
    tx: current.tx + dx * (1 - ratio),
    ty: current.ty + dy * (1 - ratio),
  }
}
