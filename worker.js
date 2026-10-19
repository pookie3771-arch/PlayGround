'use strict'

const PRESETS = {
  natural: { detail: 1.0, denoise: 1.0, saturation: 1.0 },
  crisp: { detail: 1.32, denoise: 0.72, saturation: 1.12 },
  illustration: { detail: 1.18, denoise: 0.5, saturation: 1.45 },
  restore: { detail: 0.82, denoise: 1.45, saturation: 0.85 }
}

const clamp = (value, low, high) => (value < low ? low : value > high ? high : value)

function enhance(src, width, height, settings, report) {
  const total = width * height
  const len = total * 4
  const temp = new Uint8ClampedArray(len)
  const blur = new Uint8ClampedArray(len)
  const blurLum = new Uint8Array(total)

  const preset = PRESETS[settings.preset] || PRESETS.natural
  const detailGain = (clamp(settings.detail, 0, 100) / 100) * 1.75 * preset.detail
  const denoiseBase = clamp((clamp(settings.denoise, 0, 100) / 100) * 0.92 * preset.denoise, 0, 0.94)
  const satMul = clamp(1 + (clamp(settings.saturation, 0, 100) / 100) * 0.7 * preset.saturation, 1, 1.65)
  const radius = clamp(Math.round(settings.radius || 2), 1, 24)
  const count = radius * 2 + 1
  const inverse = 1 / count
  const reportEvery = Math.max(1, Math.floor(height / 50))

  for (let y = 0; y < height; y++) {
    const row = y * width
    let sumR = 0
    let sumG = 0
    let sumB = 0
    for (let k = -radius; k <= radius; k++) {
      const index = (row + clamp(k, 0, width - 1)) * 4
      sumR += src[index]
      sumG += src[index + 1]
      sumB += src[index + 2]
    }
    for (let x = 0; x < width; x++) {
      const i = (row + x) * 4
      temp[i] = sumR * inverse
      temp[i + 1] = sumG * inverse
      temp[i + 2] = sumB * inverse
      temp[i + 3] = src[i + 3]
      const leave = (row + (x - radius < 0 ? 0 : x - radius)) * 4
      const enter = (row + (x + radius + 1 > width - 1 ? width - 1 : x + radius + 1)) * 4
      sumR += src[enter] - src[leave]
      sumG += src[enter + 1] - src[leave + 1]
      sumB += src[enter + 2] - src[leave + 2]
    }
    if (y % reportEvery === 0) report(0.34 * (y / height))
  }

  const columnSums = new Float32Array(width * 3)
  for (let k = -radius; k <= radius; k++) {
    const row = clamp(k, 0, height - 1) * width
    for (let x = 0; x < width; x++) {
      const i = (row + x) * 4
      const c = x * 3
      columnSums[c] += temp[i]
      columnSums[c + 1] += temp[i + 1]
      columnSums[c + 2] += temp[i + 2]
    }
  }

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const i = (row + x) * 4
      const c = x * 3
      const r = columnSums[c] * inverse
      const g = columnSums[c + 1] * inverse
      const b = columnSums[c + 2] * inverse
      const br = r < 0 ? 0 : r > 255 ? 255 : r
      const bg = g < 0 ? 0 : g > 255 ? 255 : g
      const bb = b < 0 ? 0 : b > 255 ? 255 : b
      blur[i] = br
      blur[i + 1] = bg
      blur[i + 2] = bb
      blur[i + 3] = src[i + 3]
      blurLum[row + x] = (br * 2126 + bg * 7152 + bb * 722) / 10000
    }

    const leaveRow = clamp(y - radius, 0, height - 1) * width
    const enterRow = clamp(y + radius + 1, 0, height - 1) * width
    for (let x = 0; x < width; x++) {
      const c = x * 3
      const leave = (leaveRow + x) * 4
      const enter = (enterRow + x) * 4
      columnSums[c] += temp[enter] - temp[leave]
      columnSums[c + 1] += temp[enter + 1] - temp[leave + 1]
      columnSums[c + 2] += temp[enter + 2] - temp[leave + 2]
    }
    if (y % reportEvery === 0) report(0.34 + 0.22 * (y / height))
  }

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const li = row + x
      const i = li * 4
      const alpha = src[i + 3]

      if (alpha === 0) continue

      const left = x > 0 ? li - 1 : li
      const right = x < width - 1 ? li + 1 : li
      const above = y > 0 ? li - width : li
      const below = y < height - 1 ? li + width : li
      const edgeRaw = Math.abs(blurLum[right] - blurLum[left]) + Math.abs(blurLum[below] - blurLum[above])
      const edge = edgeRaw > 44 ? 1 : edgeRaw / 44
      const flat = 1 - edge

      const mix = denoiseBase * flat
      let r = src[i] + (blur[i] - src[i]) * mix
      let g = src[i + 1] + (blur[i + 1] - src[i + 1]) * mix
      let b = src[i + 2] + (blur[i + 2] - src[i + 2]) * mix

      const luma = (r * 2126 + g * 7152 + b * 722) / 10000
      const baseLum = blurLum[li]
      const detail = luma - baseLum

      const protect = 1 - Math.max(0, (baseLum - 212) / 43) * 0.75 - Math.max(0, (38 - baseLum) / 38) * 0.28
      const gain = detailGain * (0.32 + 0.68 * edge) * protect
      const maxAdd = 18 + 48 * edge
      let add = detail * gain
      if (add > maxAdd) add = maxAdd
      else if (add < -maxAdd) add = -maxAdd

      r += add
      g += add
      b += add

      if (satMul !== 1) {
        const l2 = (r * 2126 + g * 7152 + b * 722) / 10000
        r = l2 + (r - l2) * satMul
        g = l2 + (g - l2) * satMul
        b = l2 + (b - l2) * satMul
      }

      src[i] = r
      src[i + 1] = g
      src[i + 2] = b
      src[i + 3] = alpha
    }
    if (y % reportEvery === 0) report(0.56 + 0.44 * (y / height))
  }

  report(1)
  return src
}

self.onmessage = (event) => {
  const { id, buffer, width, height, settings } = event.data
  try {
    const src = new Uint8ClampedArray(buffer)
    let last = -1
    const out = enhance(src, width, height, settings, (progress) => {
      if (progress - last < 0.01 && progress < 1) return
      last = progress
      self.postMessage({ type: 'progress', id, progress })
    })
    self.postMessage({ type: 'done', id, buffer: out.buffer, width, height }, [out.buffer])
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error && error.message ? error.message : 'Enhancement failed' })
  }
}
