'use client'

import { useRef, useCallback } from 'react'

interface OTPInputProps {
 length?: number
 value: string
 onChange: (value: string) => void
 disabled?: boolean
}

export function OTPInput({ length = 5, value, onChange, disabled }: OTPInputProps) {
 const inputRefs = useRef<(HTMLInputElement | null)[]>([])
 const digits = value.split('').concat(Array(length).fill('')).slice(0, length)

 const focusInput = useCallback((index: number) => {
 if (index >= 0 && index < length) {
 inputRefs.current[index]?.focus()
 }
 }, [length])

 const handleChange = (index: number, digit: string) => {
 if (!/^\d*$/.test(digit)) return

 const newDigits = [...digits]
 newDigits[index] = digit.slice(-1)
 const newValue = newDigits.join('')
 onChange(newValue)

 if (digit && index < length - 1) {
 focusInput(index + 1)
 }
 }

 const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
 if (e.key === 'Backspace') {
 if (!digits[index] && index > 0) {
 focusInput(index - 1)
 }
 } else if (e.key === 'ArrowLeft' && index > 0) {
 focusInput(index - 1)
 } else if (e.key === 'ArrowRight' && index < length - 1) {
 focusInput(index + 1)
 }
 }

 const handlePaste = (e: React.ClipboardEvent) => {
 e.preventDefault()
 const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
 if (pasted) {
 onChange(pasted)
 focusInput(Math.min(pasted.length, length - 1))
 }
 }

 return (
 <div className="flex gap-2 sm:gap-3 justify-center">
 {digits.map((digit, index) => (
 <input
 key={index}
 ref={(el) => { inputRefs.current[index] = el }}
 type="text"
 inputMode="numeric"
 maxLength={1}
 value={digit}
 disabled={disabled}
 onChange={(e) => handleChange(index, e.target.value)}
 onKeyDown={(e) => handleKeyDown(index, e)}
 onPaste={handlePaste}
 onFocus={(e) => e.target.select()}
 className="w-12 h-14 sm:w-14 sm:h-16 text-center text-2xl font-bold border-2 border-white/20 rounded-md bg-white/5 text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
 autoComplete="one-time-code"
 />
 ))}
 </div>
 )
}
