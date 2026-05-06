import { useReducedMotion } from "motion/react"

function hasUiTestFlag() {
  if (typeof document === "undefined") return false
  return document.documentElement.dataset.uiTest === "true"
}

function isAutomationRuntime() {
  if (typeof navigator === "undefined") return false
  return navigator.webdriver
}

export function useDeterministicRendering() {
  const reducedMotion = useReducedMotion()
  return reducedMotion || hasUiTestFlag() || isAutomationRuntime()
}
