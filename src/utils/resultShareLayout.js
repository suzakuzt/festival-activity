const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export const calculateResultShareMascotTopPercent = ({
  surfaceTop,
  surfaceHeight,
  signContentBottom,
  minimumGapPx = 18,
  minTopPercent = 47,
  maxTopPercent = 52,
}) => {
  if (!Number.isFinite(surfaceTop) || !Number.isFinite(surfaceHeight) || surfaceHeight <= 0) {
    return minTopPercent
  }

  if (!Number.isFinite(signContentBottom)) {
    return minTopPercent
  }

  const topPercent = ((signContentBottom - surfaceTop + minimumGapPx) / surfaceHeight) * 100
  return clamp(topPercent, minTopPercent, maxTopPercent)
}

export const calculateResultShareAiLayout = ({
  surfaceTop,
  surfaceHeight,
  signContentBottom,
  footerTop,
  minimumSignGapPx = 18,
  minimumFooterGapPx = 18,
  panelChromePx = 8,
  bodyTopOffsetPx = 0,
  minTopPercent = 44,
  maxTopPercent = 50,
  minBodyHeightPx = 136,
  maxBodyHeightPx = 168,
} = {}) => {
  const topPercent = calculateResultShareMascotTopPercent({
    surfaceTop,
    surfaceHeight,
    signContentBottom,
    minimumGapPx: minimumSignGapPx,
    minTopPercent,
    maxTopPercent,
  })

  if (!Number.isFinite(surfaceTop) || !Number.isFinite(surfaceHeight) || surfaceHeight <= 0) {
    return {
      topPercent,
      bodyHeightPx: maxBodyHeightPx,
    }
  }

  const panelTop = surfaceTop + (surfaceHeight * topPercent) / 100
  const availableHeight = Number.isFinite(footerTop)
    ? footerTop - panelTop - bodyTopOffsetPx - minimumFooterGapPx - panelChromePx
    : maxBodyHeightPx

  return {
    topPercent,
    bodyHeightPx: Math.round(clamp(availableHeight, minBodyHeightPx, maxBodyHeightPx)),
  }
}
