import { useState, useEffect, useRef } from "react"
import type { RefObject } from "react"
import { createPortal } from "react-dom"

interface PortalTooltipProps {
  text: string
  anchorRef: RefObject<HTMLElement | null>
  visible: boolean
}

// Tooltip rendered into document.body via Portal — escapes all stacking contexts
export function PortalTooltip({ text, anchorRef, visible }: PortalTooltipProps) {
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const [side, setSide] = useState<"top" | "bottom">("top")
  const [arrowLeft, setArrowLeft] = useState("50%")
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (visible && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect()
      const scrollY = window.scrollY
      const scrollX = window.scrollX
      
      const anchorCenterX = rect.left + scrollX + rect.width / 2
      const topOffset = rect.top + scrollY
      
      // Default: Top
      let top = topOffset - 8
      let currentSide: "top" | "bottom" = "top"

      // Threshold check: If less than 100px from top of viewport, show below
      if (rect.top < 100) {
        top = topOffset + rect.height + 8
        currentSide = "bottom"
      }

      setSide(currentSide)
      setCoords({ top, left: anchorCenterX })

      // Boundary check for horizontal overflow
      requestAnimationFrame(() => {
        if (tooltipRef.current) {
          const tooltipRect = tooltipRef.current.getBoundingClientRect()
          const padding = 12
          const viewportWidth = window.innerWidth
          
          let adjustedLeft = anchorCenterX
          let newArrowLeft = "50%"

          // Check right edge
          if (tooltipRect.right > viewportWidth - padding) {
            adjustedLeft = (viewportWidth - padding) - tooltipRect.width / 2
          }
          // Check left edge
          if (tooltipRect.left < padding) {
            adjustedLeft = padding + tooltipRect.width / 2
          }

          if (adjustedLeft !== anchorCenterX) {
            setCoords(prev => ({ ...prev, left: adjustedLeft }))
            // Calculate arrow position to stay aligned with the anchor center
            // anchorCenterX is where we want the arrow to point
            // adjustedLeft is the center of the shifted tooltip
            // The arrow's 'left' is relative to the tooltip's width
            const shift = anchorCenterX - adjustedLeft
            const arrowPosPercent = 50 + (shift / tooltipRect.width) * 100
            newArrowLeft = `${arrowPosPercent}%`
          }

          setArrowLeft(newArrowLeft)
        }
      })
    }
  }, [visible, anchorRef, text])

  if (!visible) return null

  return createPortal(
    <div
      ref={tooltipRef}
      className={`portal-tooltip side-${side}`}
      style={{
        position: "absolute",
        top: coords.top,
        left: coords.left,
        // The transform here must match the CSS animation 'to' state for consistency
        transform: side === "top" ? "translate(-50%, -10px)" : "translate(-50%, 10px)",
        zIndex: 99999,
        pointerEvents: "none",
        // Pass the arrow position as a CSS variable
        "--arrow-left": arrowLeft,
      } as React.CSSProperties}
    >
      {text}
      <span className="portal-tooltip-arrow" />
    </div>,
    document.body
  )
}
