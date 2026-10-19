(() => {
  'use strict'

  const MAX_SOURCE_PIXELS = 32_000_000
  const MAX_SOURCE_BYTES = 40 * 1024 * 1024
  const MAX_OUTPUT_PIXELS = 24_000_000
  const MAX_OUTPUT_DIM = 8192

  const PRESET_VALUES = {
    natural: { detail: 58, denoise: 32, saturation: 6 },
    crisp: { detail: 82, denoise: 20, saturation: 10 },
    illustration: { detail: 70, denoise: 18, saturation: 18 },
    restore: { detail: 44, denoise: 72, saturation: 3 }
  }

  const SCALE_HINTS = {
    2: 'Fast, faithful enlargement.',
    4: 'Best balance of detail and speed.',
    8: 'Maximum enlargement for small images.'
  }

  const $ = (selector) => document.querySelector(selector)

  const els = {
    hero: $('#hero'),
    workspace: $('#workspace'),
    dropzone: $('#dropzone'),
    fileInput: $('#fileInput'),
    browseBtn: $('#browseBtn'),
    newBtn: $('#newBtn'),
    fileName: $('#fileName'),
    fileDims: $('#fileDims'),
    beforeCanvas: $('#beforeCanvas'),
    afterCanvas: $('#afterCanvas'),
    compare: $('#compare'),
    stage: $('#stage'),
    splitRange: $('#splitRange'),
    divider: $('#divider'),
    scaleGroup: $('#scaleGroup'),
    scaleHint: $('#scaleHint'),
    presetGroup: $('#presetGroup'),
    detailRange: $('#detailRange'),
    detailOut: $('#detailOut'),
    denoiseRange: $('#denoiseRange'),
    denoiseOut: $('#denoiseOut'),
    saturationRange: $('#saturationRange'),
    saturationOut: $('#saturationOut'),
    formatGroup: $('#formatGroup'),
    qualityWrap: $('#qualityWrap'),
    qualityRange: $('#qualityRange'),
    qualityOut: $('#qualityOut'),
    downloadBtn: $('#downloadBtn'),
    downloadTop: $('#downloadTop'),
    downloadLabel: $('#downloadLabel'),
    viewTabs: $('#viewTabs'),
    zoomBtn: $('#zoomBtn'),
    stageLoading: $('#stageLoading'),
    loadingTitle: $('#loadingTitle'),
    loadingSub: $('#loadingSub'),
    loaderFill: $('#loaderFill'),
    metaDims: $('#metaDims'),
    metaScale: $('#metaScale'),
    metaPixels: $('#metaPixels'),
    metaTime: $('#metaTime'),
    dropOverlay: $('#dropOverlay'),
    toast: $('#toast'),
    toastText: $('#toastText'),
    thumbAurora: $('#thumbAurora'),
    thumbCafe: $('#thumbCafe')
  }

  const state = {
    bitmap: null,
    name: 'image.png',
    sourceW: 0,
    sourceH: 0,
    scale: 4,
    preset: 'natural',
    detail: 58,
    denoise: 32,
    saturation: 6,
    format: 'png',
    quality: 92,
    split: 55,
    view: 'split',
    zoom: false,
    master: null,
    outW: 0,
    outH: 0,
    effScale: 4,
    capped: false,
    worker: null,
    jobSeq: 0,
    busy: false,
    pending: false,
    rebuilding: false,
    debounce: 0,
    elapsed: 0,
    rendered: false,
    toastTimer: 0,
    toastHideTimer: 0,
    loadingTimer: 0
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  function mulberry32(seed) {
    return function random() {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))

  function formatScale(value) {
    const rounded = Math.round(value * 10) / 10
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}×`
  }

  function formatTime(ms) {
    if (!ms) return '—'
    if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`
    return `${(ms / 1000).toFixed(2)} s`
  }

  function toast(message, isError = false) {
    els.toastText.textContent = message
    els.toast.classList.toggle('is-error', Boolean(isError))
    els.toast.hidden = false
    requestAnimationFrame(() => els.toast.classList.add('is-visible'))
    clearTimeout(state.toastTimer)
    clearTimeout(state.toastHideTimer)
    state.toastTimer = setTimeout(() => {
      els.toast.classList.remove('is-visible')
      state.toastHideTimer = setTimeout(() => { els.toast.hidden = true }, 240)
    }, 3400)
  }

  function setDownloadEnabled(enabled) {
    els.downloadBtn.disabled = !enabled
    els.downloadTop.disabled = !enabled
  }

  function syncRangeFill(input) {
    const min = Number(input.min) || 0
    const max = Number(input.max) || 100
    const pct = ((Number(input.value) - min) / (max - min)) * 100
    input.style.setProperty('--p', `${pct}%`)
  }

  /* ------------------------------------------------------------------ */
  /* Sample artwork                                                      */
  /* ------------------------------------------------------------------ */

  function drawAurora(ctx, w, h) {
    const random = mulberry32(20261019)

    const sky = ctx.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#04050f')
    sky.addColorStop(0.42, '#0b1230')
    sky.addColorStop(0.72, '#123652')
    sky.addColorStop(1, '#081420')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, h)

    for (let i = 0; i < 110; i++) {
      const x = random() * w
      const y = random() * h * 0.62
      const size = random() < 0.08 ? 1.6 : 1
      ctx.fillStyle = `rgba(214,238,255,${0.16 + random() * 0.62})`
      ctx.fillRect(x, y, size, size)
    }

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const ribbons = [
      { y: h * 0.26, amp: h * 0.052, phase: 0.4, color: 'rgba(80,255,196,0.17)', width: 24 },
      { y: h * 0.33, amp: h * 0.04, phase: 2.1, color: 'rgba(88,220,255,0.13)', width: 16 },
      { y: h * 0.22, amp: h * 0.03, phase: 4.4, color: 'rgba(150,120,255,0.13)', width: 12 }
    ]
    for (const ribbon of ribbons) {
      ctx.beginPath()
      for (let x = -10; x <= w + 10; x += 4) {
        const y = ribbon.y + Math.sin(x * 0.018 + ribbon.phase) * ribbon.amp + Math.sin(x * 0.052 + ribbon.phase * 1.7) * ribbon.amp * 0.35
        if (x === -10) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = ribbon.color
      ctx.lineWidth = ribbon.width
      ctx.lineCap = 'round'
      ctx.shadowColor = ribbon.color
      ctx.shadowBlur = 18
      ctx.stroke()
    }
    ctx.restore()

    const mx = w * 0.74
    const my = h * 0.24
    const glow = ctx.createRadialGradient(mx, my, 2, mx, my, w * 0.22)
    glow.addColorStop(0, 'rgba(255,238,204,0.5)')
    glow.addColorStop(0.25, 'rgba(255,220,160,0.13)')
    glow.addColorStop(1, 'rgba(255,220,160,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(mx, my, w * 0.22, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff4d6'
    ctx.beginPath()
    ctx.arc(mx, my, w * 0.026, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#101a33'
    ctx.beginPath()
    ctx.moveTo(-20, h * 0.66)
    ctx.lineTo(w * 0.12, h * 0.37)
    ctx.lineTo(w * 0.23, h * 0.55)
    ctx.lineTo(w * 0.36, h * 0.32)
    ctx.lineTo(w * 0.49, h * 0.57)
    ctx.lineTo(w * 0.64, h * 0.38)
    ctx.lineTo(w * 0.79, h * 0.6)
    ctx.lineTo(w * 0.91, h * 0.42)
    ctx.lineTo(w + 20, h * 0.62)
    ctx.lineTo(w + 20, h * 0.78)
    ctx.lineTo(-20, h * 0.78)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = 'rgba(205,228,255,0.4)'
    const caps = [
      [w * 0.12, h * 0.37], [w * 0.36, h * 0.32],
      [w * 0.64, h * 0.38], [w * 0.91, h * 0.42]
    ]
    for (const [cx, cy] of caps) {
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx - w * 0.024, cy + h * 0.055)
      ctx.lineTo(cx - w * 0.005, cy + h * 0.04)
      ctx.lineTo(cx + w * 0.006, cy + h * 0.052)
      ctx.lineTo(cx + w * 0.025, cy + h * 0.055)
      ctx.closePath()
      ctx.fill()
    }

    const mid = ctx.createLinearGradient(0, h * 0.5, 0, h * 0.8)
    mid.addColorStop(0, '#0b1628')
    mid.addColorStop(1, '#07101d')
    ctx.fillStyle = mid
    ctx.beginPath()
    ctx.moveTo(-20, h * 0.73)
    ctx.lineTo(w * 0.08, h * 0.55)
    ctx.lineTo(w * 0.2, h * 0.66)
    ctx.lineTo(w * 0.31, h * 0.5)
    ctx.lineTo(w * 0.44, h * 0.7)
    ctx.lineTo(w * 0.56, h * 0.53)
    ctx.lineTo(w * 0.7, h * 0.71)
    ctx.lineTo(w * 0.84, h * 0.56)
    ctx.lineTo(w + 20, h * 0.7)
    ctx.lineTo(w + 20, h * 0.8)
    ctx.lineTo(-20, h * 0.8)
    ctx.closePath()
    ctx.fill()

    const lake = ctx.createLinearGradient(0, h * 0.7, 0, h)
    lake.addColorStop(0, '#0a2333')
    lake.addColorStop(0.5, '#081827')
    lake.addColorStop(1, '#040b12')
    ctx.fillStyle = lake
    ctx.fillRect(0, h * 0.7, w, h * 0.3)

    for (let i = 0; i < 26; i++) {
      const yy = h * 0.72 + random() * h * 0.26
      const half = w * 0.005 + random() * w * 0.02
      const xx = mx + (random() - 0.5) * w * 0.06
      ctx.fillStyle = `rgba(255,224,170,${0.04 + random() * 0.16})`
      ctx.fillRect(xx - half, yy, half * 2, 1)
    }
    for (let i = 0; i < 20; i++) {
      const xx = random() * w
      const yy = h * 0.72 + random() * h * 0.24
      ctx.fillStyle = `rgba(88,230,200,${0.02 + random() * 0.07})`
      ctx.fillRect(xx, yy, w * (0.01 + random() * 0.05), 1)
    }

    ctx.fillStyle = '#03070c'
    ctx.beginPath()
    ctx.moveTo(-20, h * 0.83)
    ctx.quadraticCurveTo(w * 0.2, h * 0.79, w * 0.32, h * 0.88)
    ctx.quadraticCurveTo(w * 0.46, h * 0.95, w * 0.6, h * 0.87)
    ctx.quadraticCurveTo(w * 0.78, h * 0.8, w + 20, h * 0.88)
    ctx.lineTo(w + 20, h + 20)
    ctx.lineTo(-20, h + 20)
    ctx.closePath()
    ctx.fill()

    const cx = w * 0.19
    const cy = h * 0.68
    ctx.save()
    ctx.fillStyle = '#241812'
    ctx.fillRect(cx, cy, w * 0.038, w * 0.027)
    ctx.fillStyle = '#170f0b'
    ctx.beginPath()
    ctx.moveTo(cx - w * 0.007, cy)
    ctx.lineTo(cx + w * 0.019, cy - w * 0.016)
    ctx.lineTo(cx + w * 0.045, cy)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#ffd489'
    ctx.shadowColor = 'rgba(255,205,120,0.8)'
    ctx.shadowBlur = 6
    ctx.fillRect(cx + w * 0.014, cy + w * 0.008, w * 0.008, w * 0.007)
    ctx.restore()

    function tree(tx, ty, scale) {
      ctx.fillStyle = '#020508'
      ctx.beginPath()
      ctx.moveTo(tx, ty - scale * 18)
      ctx.lineTo(tx - scale * 6, ty)
      ctx.lineTo(tx + scale * 6, ty)
      ctx.closePath()
      ctx.fill()
      ctx.fillRect(tx - scale * 0.7, ty, scale * 1.4, scale * 4)
    }
    tree(w * 0.07, h * 0.79, 1)
    tree(w * 0.12, h * 0.82, 0.8)
    tree(w * 0.9, h * 0.8, 1.1)
    tree(w * 0.95, h * 0.84, 0.75)

    ctx.strokeStyle = 'rgba(180,205,225,0.65)'
    ctx.lineWidth = 1
    const birds = [[w * 0.44, h * 0.22, 1], [w * 0.5, h * 0.25, 0.8], [w * 0.55, h * 0.2, 0.9]]
    for (const [bx, by, s] of birds) {
      ctx.beginPath()
      ctx.moveTo(bx - s * 3, by)
      ctx.quadraticCurveTo(bx - s * 1.2, by - s * 2, bx, by)
      ctx.quadraticCurveTo(bx + s * 1.2, by - s * 2, bx + s * 3, by)
      ctx.stroke()
    }
  }

  const SAMPLES = {
    cafe: { w: 360, h: 240, name: 'Cafe Study', file: 'cafe-study.jpg', url: 'samples/cafe.jpg' },
    aurora: { w: 360, h: 240, draw: drawAurora, name: 'Aurora Peaks', file: 'aurora-peaks.png' }
  }

  async function sampleSource(sample) {
    if (sample.draw) {
      const source = document.createElement('canvas')
      source.width = sample.w
      source.height = sample.h
      sample.draw(source.getContext('2d'), sample.w, sample.h)
      return source
    }
    const response = await fetch(sample.url)
    if (!response.ok) throw new Error('Sample image is unavailable')
    const blob = await response.blob()
    return createImageBitmap(blob)
  }

  async function paintThumb(canvas, sample) {
    const ctx = canvas.getContext('2d')
    const source = await sampleSource(sample)
    const sourceW = source.width
    const sourceH = source.height

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#070b13'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const scale = Math.min(canvas.width / sourceW, canvas.height / sourceH)
    const dw = sourceW * scale
    const dh = sourceH * scale
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh)
    if (source.close) source.close()
  }

  /* ------------------------------------------------------------------ */
  /* Worker + rendering                                                  */
  /* ------------------------------------------------------------------ */

  function setupWorker() {
    try {
      state.worker = new Worker('worker.js?v=3')
      state.worker.onmessage = onWorkerMessage
      state.worker.onerror = () => {
        state.busy = false
        hideLoading()
        toast('The enhancement worker could not start.', true)
      }
    } catch (error) {
      state.worker = null
    }
  }

  function computeTarget() {
    const rawW = state.sourceW * state.scale
    const rawH = state.sourceH * state.scale
    const pixelScale = Math.sqrt(MAX_OUTPUT_PIXELS / (rawW * rawH))
    const dimScale = Math.min(MAX_OUTPUT_DIM / rawW, MAX_OUTPUT_DIM / rawH)
    const capScale = Math.min(1, pixelScale, dimScale)
    const effScale = state.scale * capScale
    const outW = Math.max(1, Math.round(state.sourceW * effScale))
    const outH = Math.max(1, Math.round(state.sourceH * effScale))
    return {
      outW,
      outH,
      effScale: outW / state.sourceW,
      capped: capScale < 0.999
    }
  }

  function progressiveUpscale(bitmap, targetW, targetH) {
    let current = document.createElement('canvas')
    current.width = bitmap.width
    current.height = bitmap.height
    const first = current.getContext('2d')
    first.imageSmoothingEnabled = true
    first.imageSmoothingQuality = 'high'
    first.drawImage(bitmap, 0, 0)

    let w = bitmap.width
    let h = bitmap.height

    while (w * 2 <= targetW * 1.01 && h * 2 <= targetH * 1.01) {
      const nextW = Math.min(w * 2, targetW)
      const nextH = Math.min(h * 2, targetH)
      const next = document.createElement('canvas')
      next.width = nextW
      next.height = nextH
      const ctx = next.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(current, 0, 0, nextW, nextH)
      current = next
      w = nextW
      h = nextH
      if (w === targetW && h === targetH) return current
    }

    if (w !== targetW || h !== targetH) {
      const final = document.createElement('canvas')
      final.width = targetW
      final.height = targetH
      const ctx = final.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(current, 0, 0, targetW, targetH)
      return final
    }

    return current
  }

  function showLoading(title, sub, progress = 0.02) {
    clearTimeout(state.loadingTimer)
    els.loadingTitle.textContent = title
    els.loadingSub.textContent = sub
    els.loaderFill.style.width = `${Math.max(4, Math.round(progress * 100))}%`
    els.stageLoading.hidden = false
  }

  function hideLoading() {
    els.stageLoading.hidden = true
  }

  function updateMeta() {
    els.metaDims.textContent = `${state.sourceW} × ${state.sourceH} → ${state.outW} × ${state.outH}`
    els.metaScale.textContent = state.capped ? `${formatScale(state.effScale)} capped` : `${formatScale(state.effScale)} upscale`
    els.metaPixels.textContent = `${((state.outW * state.outH) / 1_000_000).toFixed(1)} MP`
    els.metaTime.textContent = state.elapsed ? `Enhanced in ${formatTime(state.elapsed)}` : 'Enhancing…'
  }

  function updateScaleUi() {
    for (const button of els.scaleGroup.querySelectorAll('button')) {
      const active = Number(button.dataset.scale) === state.scale
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-checked', String(active))
    }
    if (!state.bitmap) {
      els.scaleHint.textContent = SCALE_HINTS[state.scale]
      return
    }
    const target = computeTarget()
    els.scaleHint.textContent = target.capped
      ? `Output capped at ${MAX_OUTPUT_PIXELS / 1_000_000} MP to keep processing responsive.`
      : SCALE_HINTS[state.scale]
  }

  function updatePresetUi() {
    for (const button of els.presetGroup.querySelectorAll('button')) {
      const active = button.dataset.preset === state.preset
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-checked', String(active))
    }
  }

  function setSlider(name, value) {
    const input = els[`${name}Range`]
    const output = els[`${name}Out`]
    state[name] = value
    input.value = String(value)
    output.textContent = String(value)
    syncRangeFill(input)
  }

  function updateFormatUi() {
    for (const button of els.formatGroup.querySelectorAll('button')) {
      const active = button.dataset.format === state.format
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-checked', String(active))
    }
    const lossy = state.format !== 'png'
    els.qualityWrap.hidden = !lossy
    els.downloadLabel.textContent = `Download ${state.format === 'jpeg' ? 'JPG' : state.format === 'webp' ? 'WebP' : 'PNG'}`
  }

  function updateSplit() {
    els.compare.style.setProperty('--split', `${state.split}%`)
    els.splitRange.value = String(state.split)
  }

  function setView(view) {
    state.view = view
    els.compare.dataset.mode = view
    for (const button of els.viewTabs.querySelectorAll('button')) {
      const active = button.dataset.view === view
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-selected', String(active))
    }
    els.splitRange.disabled = view !== 'split'
  }

  function onWorkerMessage(event) {
    const message = event.data
    if (!message) return

    if (message.type === 'progress') {
      if (message.id !== state.jobSeq || !state.busy) return
      const pct = Math.min(99, Math.round(message.progress * 100))
      els.loaderFill.style.width = `${Math.max(4, pct)}%`
      els.loadingSub.textContent = `Applying adaptive detail · ${pct}%`
      return
    }

    if (message.type === 'done') {
      const stale = message.id !== state.jobSeq || message.width !== state.outW || message.height !== state.outH
      state.busy = false
      if (!stale && !state.pending) {
        try {
          const pixels = new Uint8ClampedArray(message.buffer)
          const image = new ImageData(pixels, message.width, message.height)
          const ctx = els.afterCanvas.getContext('2d')
          ctx.putImageData(image, 0, 0)
          state.elapsed = performance.now() - (state.jobStart || performance.now())
          state.rendered = true
          updateMeta()
          setDownloadEnabled(true)
        } catch (error) {
          toast('Could not display the upscaled result.', true)
        }
      }
      if (state.pending) {
        state.pending = false
        runEnhance()
      } else if (!state.rebuilding) {
        hideLoading()
      }
      return
    }

    if (message.type === 'error') {
      state.busy = false
      state.pending = false
      hideLoading()
      setDownloadEnabled(false)
      toast('Enhancement failed. Try a smaller image.', true)
    }
  }

  function runEnhance() {
    if (!state.master) return
    if (state.debounce) {
      clearTimeout(state.debounce)
      state.debounce = 0
    }
    if (state.busy) {
      state.pending = true
      return
    }
    if (!state.worker) {
      hideLoading()
      toast('This browser cannot start the enhancement worker.', true)
      return
    }

    const id = ++state.jobSeq
    state.busy = true
    state.rendered = false
    state.elapsed = 0
    setDownloadEnabled(false)
    showLoading('Enhancing pixels', 'Reading edges and texture…', 0.03)
    els.metaTime.textContent = 'Enhancing…'

    const copy = state.master.data.slice()
    state.jobStart = performance.now()
    state.worker.postMessage({
      id,
      buffer: copy.buffer,
      width: state.master.width,
      height: state.master.height,
      settings: {
        detail: state.detail,
        denoise: state.denoise,
        saturation: state.saturation,
        preset: state.preset,
        radius: Math.max(2, Math.round(state.effScale * 1.5))
      }
    }, [copy.buffer])
  }

  function scheduleEnhance(delay = 220) {
    clearTimeout(state.debounce)
    state.debounce = window.setTimeout(() => {
      state.debounce = 0
      runEnhance()
    }, delay)
  }

  async function rebuild() {
    if (!state.bitmap) return

    clearTimeout(state.debounce)
    state.debounce = 0
    if (state.busy) {
      state.jobSeq += 1
      state.pending = false
    }
    setDownloadEnabled(false)
    state.rendered = false
    state.elapsed = 0
    state.rebuilding = true

    const target = computeTarget()
    state.outW = target.outW
    state.outH = target.outH
    state.effScale = target.effScale
    state.capped = target.capped

    els.beforeCanvas.width = state.outW
    els.beforeCanvas.height = state.outH
    els.afterCanvas.width = state.outW
    els.afterCanvas.height = state.outH

    els.metaDims.textContent = `${state.sourceW} × ${state.sourceH} → ${state.outW} × ${state.outH}`
    els.metaScale.textContent = state.capped ? `${formatScale(state.effScale)} capped` : `${formatScale(state.effScale)} upscale`
    els.metaPixels.textContent = `${((state.outW * state.outH) / 1_000_000).toFixed(1)} MP`
    els.metaTime.textContent = 'Resampling…'
    updateScaleUi()

    showLoading('Resampling image', `Building a ${state.outW} × ${state.outH} canvas…`, 0.03)
    await nextFrame()

    try {
      const beforeCtx = els.beforeCanvas.getContext('2d')
      beforeCtx.imageSmoothingEnabled = true
      beforeCtx.imageSmoothingQuality = 'high'
      beforeCtx.clearRect(0, 0, state.outW, state.outH)
      beforeCtx.drawImage(state.bitmap, 0, 0, state.outW, state.outH)

      const upscaled = progressiveUpscale(state.bitmap, state.outW, state.outH)
      const afterCtx = els.afterCanvas.getContext('2d')
      afterCtx.imageSmoothingEnabled = true
      afterCtx.imageSmoothingQuality = 'high'
      afterCtx.clearRect(0, 0, state.outW, state.outH)
      afterCtx.drawImage(upscaled, 0, 0)

      const readCanvas = document.createElement('canvas')
      readCanvas.width = state.outW
      readCanvas.height = state.outH
      const readCtx = readCanvas.getContext('2d', { willReadFrequently: true })
      readCtx.drawImage(upscaled, 0, 0)
      state.master = readCtx.getImageData(0, 0, state.outW, state.outH)
      state.rebuilding = false
      runEnhance()
    } catch (error) {
      state.rebuilding = false
      hideLoading()
      toast('This image is too large to process in your browser.', true)
    }
  }

  /* ------------------------------------------------------------------ */
  /* Loading images                                                      */
  /* ------------------------------------------------------------------ */

  function resetView() {
    state.split = 55
    state.view = 'split'
    state.zoom = false
    els.stage.classList.remove('actual')
    els.zoomBtn.setAttribute('aria-pressed', 'false')
    els.zoomBtn.querySelector('span').textContent = '1:1'
    updateSplit()
    setView('split')
  }

  async function acceptBitmap(bitmap, name) {
    if (!bitmap || !bitmap.width || !bitmap.height) {
      toast('That image could not be decoded.', true)
      return false
    }
    if (bitmap.width * bitmap.height > MAX_SOURCE_PIXELS) {
      bitmap.close()
      toast(`Images up to ${MAX_SOURCE_PIXELS / 1_000_000} MP are supported.`, true)
      return false
    }

    if (state.bitmap && state.bitmap !== bitmap) state.bitmap.close()
    state.bitmap = bitmap
    state.name = name || 'image.png'
    state.sourceW = bitmap.width
    state.sourceH = bitmap.height
    state.master = null
    state.rendered = false
    state.elapsed = 0

    els.fileName.textContent = state.name
    els.fileName.title = state.name
    els.fileDims.textContent = `${state.sourceW} × ${state.sourceH}px · ${((state.sourceW * state.sourceH) / 1_000_000).toFixed(2)} MP`
    els.hero.hidden = true
    els.workspace.hidden = false
    resetView()
    updateScaleUi()

    setTimeout(() => {
      els.workspace.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 30)

    await rebuild()
    return true
  }

  async function loadFile(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('That file is not a supported image.', true)
      return
    }
    if (file.size > MAX_SOURCE_BYTES) {
      toast('That file is over the 40 MB limit.', true)
      return
    }

    els.dropzone.classList.add('is-busy')
    try {
      let bitmap
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      } catch (error) {
        bitmap = await createImageBitmap(file)
      }
      await acceptBitmap(bitmap, file.name)
    } catch (error) {
      toast('Could not read that image. Try a PNG, JPG, WebP, or AVIF.', true)
    } finally {
      els.dropzone.classList.remove('is-busy')
      els.fileInput.value = ''
    }
  }

  async function loadSample(key) {
    const sample = SAMPLES[key]
    if (!sample) return
    els.dropzone.classList.add('is-busy')
    try {
      const source = await sampleSource(sample)
      const bitmap = source instanceof ImageBitmap ? source : await createImageBitmap(source)
      await acceptBitmap(bitmap, sample.file)
    } catch (error) {
      toast('Could not build the sample image.', true)
    } finally {
      els.dropzone.classList.remove('is-busy')
    }
  }

  function startOver() {
    if (state.bitmap) state.bitmap.close()
    state.bitmap = null
    state.master = null
    state.rendered = false
    state.sourceW = 0
    state.sourceH = 0
    state.outW = 0
    state.outH = 0
    state.jobSeq += 1
    state.pending = false
    clearTimeout(state.debounce)
    state.debounce = 0
    hideLoading()
    setDownloadEnabled(false)
    els.workspace.hidden = true
    els.hero.hidden = false
    els.fileInput.value = ''
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /* ------------------------------------------------------------------ */
  /* Download                                                           */
  /* ------------------------------------------------------------------ */

  function exportName() {
    const base = state.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image'
    const scale = formatScale(state.effScale).replace('×', 'x')
    return `${base}-${scale}-lumen.${state.format === 'jpeg' ? 'jpg' : state.format}`
  }

  function download() {
    if (!state.rendered) {
      toast('Still rendering — one moment.', true)
      return
    }
    const mime = state.format === 'jpeg' ? 'image/jpeg' : state.format === 'webp' ? 'image/webp' : 'image/png'
    const filename = exportName()
    let source = els.afterCanvas

    if (state.format === 'jpeg') {
      const flat = document.createElement('canvas')
      flat.width = state.outW
      flat.height = state.outH
      const ctx = flat.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, state.outW, state.outH)
      ctx.drawImage(els.afterCanvas, 0, 0)
      source = flat
    }

    source.toBlob((blob) => {
      if (!blob) {
        toast('Export failed. Try another format.', true)
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2500)
      toast(`Saved ${filename}`)
    }, mime, state.quality / 100)
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    els.browseBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      els.fileInput.click()
    })

    els.dropzone.addEventListener('click', (event) => {
      if (event.target.closest('.sample-btn')) return
      if (event.target.closest('button') && !event.target.closest('#browseBtn')) return
      els.fileInput.click()
    })

    els.dropzone.addEventListener('keydown', (event) => {
      if (event.target !== els.dropzone) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        els.fileInput.click()
      }
    })

    els.fileInput.addEventListener('change', () => {
      const file = els.fileInput.files && els.fileInput.files[0]
      if (file) loadFile(file)
    })

    for (const button of document.querySelectorAll('.sample-btn')) {
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        loadSample(button.dataset.sample)
      })
    }

    els.newBtn.addEventListener('click', startOver)
    els.downloadBtn.addEventListener('click', download)
    els.downloadTop.addEventListener('click', download)

    els.scaleGroup.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-scale]')
      if (!button) return
      const scale = Number(button.dataset.scale)
      if (scale === state.scale) return
      state.scale = scale
      updateScaleUi()
      rebuild()
    })

    els.presetGroup.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-preset]')
      if (!button) return
      state.preset = button.dataset.preset
      const values = PRESET_VALUES[state.preset]
      setSlider('detail', values.detail)
      setSlider('denoise', values.denoise)
      setSlider('saturation', values.saturation)
      updatePresetUi()
      scheduleEnhance(40)
    })

    for (const [name, input] of [
      ['detail', els.detailRange],
      ['denoise', els.denoiseRange],
      ['saturation', els.saturationRange]
    ]) {
      input.addEventListener('input', () => {
        setSlider(name, Number(input.value))
        state.preset = 'custom'
        updatePresetUi()
        scheduleEnhance()
      })
    }

    els.formatGroup.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-format]')
      if (!button) return
      state.format = button.dataset.format
      updateFormatUi()
    })

    els.qualityRange.addEventListener('input', () => {
      state.quality = Number(els.qualityRange.value)
      els.qualityOut.textContent = `${state.quality}%`
      syncRangeFill(els.qualityRange)
    })

    els.viewTabs.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-view]')
      if (!button) return
      setView(button.dataset.view)
    })

    els.splitRange.addEventListener('input', () => {
      state.split = Number(els.splitRange.value)
      updateSplit()
    })

    els.zoomBtn.addEventListener('click', () => {
      state.zoom = !state.zoom
      els.stage.classList.toggle('actual', state.zoom)
      els.zoomBtn.setAttribute('aria-pressed', String(state.zoom))
      els.zoomBtn.querySelector('span').textContent = state.zoom ? 'Fit' : '1:1'
    })

    let dragDepth = 0
    const setDrag = (active) => {
      document.body.classList.toggle('is-dragging', active)
      els.dropzone.classList.toggle('is-drag', active)
      els.dropOverlay.classList.toggle('is-visible', active)
      els.dropOverlay.setAttribute('aria-hidden', String(!active))
    }

    window.addEventListener('dragenter', (event) => {
      if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return
      event.preventDefault()
      dragDepth += 1
      setDrag(true)
    })

    window.addEventListener('dragover', (event) => {
      if (!event.dataTransfer) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    })

    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1)
      if (dragDepth === 0) setDrag(false)
    })

    window.addEventListener('drop', (event) => {
      if (!event.dataTransfer) return
      event.preventDefault()
      dragDepth = 0
      setDrag(false)
      const file = event.dataTransfer.files && event.dataTransfer.files[0]
      if (file) loadFile(file)
    })

    document.addEventListener('paste', (event) => {
      const items = event.clipboardData ? Array.from(event.clipboardData.items) : []
      const item = items.find((entry) => entry.type.startsWith('image/'))
      if (!item) return
      const file = item.getAsFile()
      if (file) loadFile(file)
    })

    window.addEventListener('beforeunload', () => {
      if (state.bitmap) state.bitmap.close()
    })
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */

  function init() {
    setupWorker()
    paintThumb(els.thumbCafe, SAMPLES.cafe).catch(() => {})
    paintThumb(els.thumbAurora, SAMPLES.aurora).catch(() => {})
    bindEvents()

    for (const input of [els.detailRange, els.denoiseRange, els.saturationRange, els.qualityRange]) {
      syncRangeFill(input)
    }
    setSlider('detail', state.detail)
    setSlider('denoise', state.denoise)
    setSlider('saturation', state.saturation)
    updateFormatUi()
    updatePresetUi()
    updateScaleUi()
    updateSplit()
    setView('split')
    setDownloadEnabled(false)
  }

  init()
})()
