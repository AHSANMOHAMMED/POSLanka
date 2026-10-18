'use client'

import { useState } from 'react'
import { Plus, Minus } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { FadeIn } from './motion'

interface FAQItem {
  question: string
  answer: string
}

interface FAQAccordionProps {
  items: FAQItem[]
}

export default function FAQAccordion({ items }: FAQAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <FadeIn className="max-w-3xl mx-auto">
      <div className="space-y-3">
        {items.map((item, i) => {
          const isOpen = openIndex === i
          return (
            <div
              key={i}
              className={`rounded-2xl overflow-hidden bg-white/5 border transition-all duration-300 ${
                isOpen ? 'border-emerald-500/30 shadow-lg shadow-emerald-500/5' : 'border-white/10'
              }`}
            >
              <button
                id={`faq-question-${i}`}
                onClick={() => setOpenIndex(isOpen ? null : i)}
                className="w-full flex items-center justify-between p-5 text-left"
                aria-expanded={isOpen}
                aria-controls={`faq-answer-${i}`}
              >
                <div className="flex items-center gap-3 pr-4">
                  {isOpen && <div className="w-1 h-6 rounded-full bg-gradient-to-b from-emerald-600 to-emerald-500 flex-shrink-0" />}
                  <span className="text-sm sm:text-base font-semibold text-white">{item.question}</span>
                </div>
                <div className={`w-7 h-7 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                  isOpen ? 'bg-gradient-to-br from-blue-600 to-violet-600 text-white' : 'bg-white/10 text-zinc-500'
                }`}>
                  {isOpen ? <Minus size={14} /> : <Plus size={14} />}
                </div>
              </button>
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    id={`faq-answer-${i}`}
                    role="region"
                    aria-labelledby={`faq-question-${i}`}
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-5 text-sm text-zinc-400 leading-relaxed">
                      {item.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </FadeIn>
  )
}
