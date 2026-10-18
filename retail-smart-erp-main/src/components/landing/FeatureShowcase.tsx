'use client'

import Image from 'next/image'
import { Check } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { FadeInLeft, FadeInRight, BrowserMockup, motion, useInView } from './motion'

interface FeatureShowcaseProps {
  title: string
  description: string
  features: string[]
  image?: string
  mockup?: ReactNode
  reversed?: boolean
  gradient?: string
}

function FeatureList({ features, gradient = 'from-emerald-500 to-emerald-600' }: { features: string[]; gradient?: string }) {
  const ref = useRef<HTMLUListElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-40px' })

  return (
    <ul ref={ref} className="mt-6 space-y-3">
      {features.map((feature, i) => (
        <motion.li
          key={i}
          initial={{ opacity: 0, x: -20 }}
          animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
          transition={{ duration: 0.4, delay: i * 0.1, ease: 'easeOut' }}
          className="flex items-start gap-3"
        >
          <div className={`mt-0.5 w-5 h-5 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center flex-shrink-0`}>
            <Check className="w-3 h-3 text-white" />
          </div>
          <span className="text-sm text-zinc-300 font-medium">{feature}</span>
        </motion.li>
      ))}
    </ul>
  )
}

export default function FeatureShowcase({
  title,
  description,
  features,
  image,
  mockup,
  reversed = false,
  gradient = 'from-emerald-500 to-emerald-600',
}: FeatureShowcaseProps) {
  const ImageBlock = mockup ? (
    <BrowserMockup url="app.retailsmarterp.com">
      {mockup}
    </BrowserMockup>
  ) : image ? (
    <BrowserMockup>
      <div className="relative aspect-[4/3] group">
        <Image
          src={image}
          alt={title}
          fill
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-cover"
        />
      </div>
    </BrowserMockup>
  ) : null

  const TextBlock = (
    <div className="flex flex-col justify-center">
      <h2 className="text-2xl sm:text-3xl font-bold text-white">{title}</h2>
      <p className="mt-4 text-zinc-400 leading-relaxed">{description}</p>
      <FeatureList features={features} gradient={gradient} />
    </div>
  )

  return (
    <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
      {reversed ? (
        <>
          <FadeInRight className="order-1 lg:order-2">{ImageBlock}</FadeInRight>
          <FadeInLeft className="order-2 lg:order-1">{TextBlock}</FadeInLeft>
        </>
      ) : (
        <>
          <FadeInLeft>{ImageBlock}</FadeInLeft>
          <FadeInRight>{TextBlock}</FadeInRight>
        </>
      )}
    </div>
  )
}
