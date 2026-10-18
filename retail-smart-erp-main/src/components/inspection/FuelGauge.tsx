'use client'

import { Fuel } from 'lucide-react'

interface Props {
  value: number
  onChange?: (value: number) => void
  readonly?: boolean
}

const fuelLevels = [
  { value: 0, label: 'E' },
  { value: 25, label: '1/4' },
  { value: 50, label: '1/2' },
  { value: 75, label: '3/4' },
  { value: 100, label: 'F' },
]

export function FuelGauge({ value, onChange, readonly = false }: Props) {
  const getColor = (level: number) => {
    if (level <= 25) return 'bg-red-500'
    if (level <= 50) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange?.(parseInt(e.target.value))
  }

  const handlePresetClick = (presetValue: number) => {
    if (!readonly) {
      onChange?.(presetValue)
    }
  }

  return (
    <div className="space-y-3">
      {/* Visual gauge */}
      <div className="relative bg-gray-100 rounded-full h-8 overflow-hidden">
        <div
          className={`absolute left-0 top-0 h-full transition-all ${getColor(value)}`}
          style={{ width: `${value}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-between px-3 text-xs font-medium">
          <span className={value < 15 ? 'text-white' : 'text-gray-600'}>E</span>
          <span className={value > 85 ? 'text-white' : 'text-gray-600'}>F</span>
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-sm font-bold ${value > 40 && value < 60 ? 'text-white' : 'text-gray-700'}`}>
            {value}%
          </span>
        </div>
      </div>

      {/* Slider */}
      {!readonly && (
        <div className="px-1">
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={value}
            onChange={handleSliderChange}
            className="w-full h-2 bg-gray-200 rounded appearance-none cursor-pointer accent-blue-600"
          />
        </div>
      )}

      {/* Preset buttons */}
      <div className="flex justify-between gap-2">
        {fuelLevels.map((level) => (
          <button
            key={level.value}
            type="button"
            onClick={() => handlePresetClick(level.value)}
            disabled={readonly}
            className={`flex-1 py-2 text-sm font-medium rounded transition-colors ${
              value === level.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:hover:bg-gray-100'
            } disabled:cursor-default`}
          >
            {level.label}
          </button>
        ))}
      </div>

      {/* Icon and value display */}
      <div className="flex items-center justify-center gap-2 text-gray-600">
        <Fuel size={20} className={value <= 25 ? 'text-red-500' : 'text-gray-400'} />
        <span className="text-sm">
          Fuel Level: <span className="font-medium">{value}%</span>
        </span>
      </div>
    </div>
  )
}
