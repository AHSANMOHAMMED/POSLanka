'use client'

import { useCallback, useRef, useState, useEffect } from 'react'

export function useSetupSound() {
  const ctxRef = useRef<AudioContext | null>(null)
  const [isMuted, setIsMuted] = useState(true) // default muted, load from localStorage on mount
  const reducedMotion = useRef(false)

  useEffect(() => {
    const stored = localStorage.getItem('setup-wizard-sound-muted')
    if (stored !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsMuted(stored === 'true')
    } else {
      setIsMuted(false) // first visit = sound on
    }
    reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioContext()
      } catch {
        return null
      }
    }
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume()
    }
    return ctxRef.current
  }, [])

  const canPlay = useCallback(() => {
    return !isMuted && !reducedMotion.current
  }, [isMuted])

  const playClick = useCallback(() => {
    if (!canPlay()) return
    const ctx = getCtx()
    if (!ctx) return
    try {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 600
      gain.gain.value = 0.1
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.02)
    } catch { /* ignore */ }
  }, [canPlay, getCtx])

  const playStepComplete = useCallback(() => {
    if (!canPlay()) return
    const ctx = getCtx()
    if (!ctx) return
    try {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(800, ctx.currentTime)
      osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.08)
      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.12)
    } catch { /* ignore */ }
  }, [canPlay, getCtx])

  const playAiSuggest = useCallback(() => {
    if (!canPlay()) return
    const ctx = getCtx()
    if (!ctx) return
    try {
      // First tone
      const osc1 = ctx.createOscillator()
      const gain1 = ctx.createGain()
      osc1.type = 'sine'
      osc1.frequency.value = 1047 // C6
      gain1.gain.setValueAtTime(0.12, ctx.currentTime)
      gain1.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1)
      osc1.connect(gain1)
      gain1.connect(ctx.destination)
      osc1.start(ctx.currentTime)
      osc1.stop(ctx.currentTime + 0.1)

      // Second tone
      const osc2 = ctx.createOscillator()
      const gain2 = ctx.createGain()
      osc2.type = 'sine'
      osc2.frequency.value = 1319 // E6
      gain2.gain.setValueAtTime(0.12, ctx.currentTime + 0.08)
      gain2.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.18)
      osc2.connect(gain2)
      gain2.connect(ctx.destination)
      osc2.start(ctx.currentTime + 0.08)
      osc2.stop(ctx.currentTime + 0.18)
    } catch { /* ignore */ }
  }, [canPlay, getCtx])

  const playSetupComplete = useCallback(() => {
    if (!canPlay()) return
    const ctx = getCtx()
    if (!ctx) return
    try {
      const freqs = [523.25, 659.25, 783.99] // C5, E5, G5
      freqs.forEach((freq) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.15, ctx.currentTime)
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.4)
      })
    } catch { /* ignore */ }
  }, [canPlay, getCtx])

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev
      localStorage.setItem('setup-wizard-sound-muted', String(next))
      return next
    })
  }, [])

  return { playClick, playStepComplete, playAiSuggest, playSetupComplete, isMuted, toggleMute }
}
