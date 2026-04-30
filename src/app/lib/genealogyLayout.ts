export const GENEALOGY_LAYOUT_SETTLE_DELAYS_MS = [
  0,
  80,
  160,
  280,
  450,
  700,
  1000,
  1400,
  1900,
] as const

interface ComputeGenealogyAutoFitScaleArgs {
  containerWidth: number
  containerHeight: number
  treeWidth: number
  treeHeight: number
  zoomBoost?: number
  minScale?: number
  maxScale?: number
}

export function computeGenealogyAutoFitScale({
  containerWidth,
  containerHeight,
  treeWidth,
  treeHeight,
  zoomBoost = 1.1,
  minScale = 0.15,
  maxScale = 1.2,
}: ComputeGenealogyAutoFitScaleArgs): number {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    treeWidth <= 0 ||
    treeHeight <= 0
  ) {
    return 1
  }

  const scaleX = containerWidth / treeWidth
  const scaleY = containerHeight / treeHeight
  const rawScale = Math.min(scaleX, scaleY) * zoomBoost

  return Math.min(Math.max(rawScale, minScale), maxScale)
}
