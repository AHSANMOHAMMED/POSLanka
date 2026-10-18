'use client'

interface StepFiscalYearProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (data: any) => void
  onNext: () => void
  onBack: () => void
}

export function StepFiscalYear({ data, onChange, onNext, onBack }: StepFiscalYearProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onNext()
  }

  // Get current date for defaults
  const today = new Date()
  const currentYear = today.getFullYear()
  const nextYear = currentYear + 1

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Fiscal Year</h2>
        <p className="text-gray-600">
          Set your fiscal year period. This is used for financial reporting and tax purposes.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="fiscalYearStart" className="block text-sm font-medium text-gray-700 mb-1">
              Fiscal Year Start Date *
            </label>
            <input
              type="date"
              id="fiscalYearStart"
              value={data.fiscalYearStart || `${currentYear}-01-01`}
              onChange={(e) => onChange({ ...data, fiscalYearStart: e.target.value })}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Typically January 1st for calendar year businesses
            </p>
          </div>

          <div>
            <label htmlFor="fiscalYearEnd" className="block text-sm font-medium text-gray-700 mb-1">
              Fiscal Year End Date *
            </label>
            <input
              type="date"
              id="fiscalYearEnd"
              value={data.fiscalYearEnd || `${currentYear}-12-31`}
              onChange={(e) => onChange({ ...data, fiscalYearEnd: e.target.value })}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Typically December 31st for calendar year businesses
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="fiscalYearName" className="block text-sm font-medium text-gray-700 mb-1">
            Fiscal Year Name
          </label>
          <input
            type="text"
            id="fiscalYearName"
            value={data.fiscalYearName || `${currentYear}-${nextYear}`}
            onChange={(e) => onChange({ ...data, fiscalYearName: e.target.value })}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            placeholder={`e.g., ${currentYear}-${nextYear}`}
          />
          <p className="mt-1 text-xs text-gray-500">
            A descriptive name for this fiscal year
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
          <h3 className="text-sm font-medium text-blue-800 mb-2">Fiscal Year Information</h3>
          <p className="text-sm text-blue-700">
            The fiscal year defines your company&apos;s financial reporting period. All financial statements,
            tax calculations, and reporting will be based on this period.
          </p>
        </div>

        <div className="flex justify-between pt-6 border-t border-gray-200">
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Back
          </button>
          <button
            type="submit"
            className="px-6 py-2.5 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Save & Continue
          </button>
        </div>
      </form>
    </div>
  )
}