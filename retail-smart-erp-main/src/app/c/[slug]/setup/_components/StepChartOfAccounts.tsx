'use client'

interface StepChartOfAccountsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (data: any) => void
  onNext: () => void
  onBack: () => void
}

export function StepChartOfAccounts({ data, onChange, onNext, onBack }: StepChartOfAccountsProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onNext()
  }

  const coaTemplates = [
    { id: 'standard', name: 'Standard', description: 'General purpose chart of accounts for most businesses' },
    { id: 'manufacturing', name: 'Manufacturing', description: 'Includes work-in-progress, finished goods, and production accounts' },
    { id: 'retail', name: 'Retail', description: 'Optimized for retail businesses with inventory tracking' },
    { id: 'service', name: 'Service', description: 'Simplified for service-based businesses without inventory' },
  ]

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Chart of Accounts</h2>
        <p className="text-gray-600">
          Select a chart of accounts template that matches your business type.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {coaTemplates.map((template) => (
            <label
              key={template.id}
              className={`relative flex cursor-pointer rounded border p-4 focus:outline-none ${
                data.coaTemplate === template.id
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500'
                  : 'border-gray-300 bg-white hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="coaTemplate"
                value={template.id}
                checked={data.coaTemplate === template.id}
                onChange={(e) => onChange({ ...data, coaTemplate: e.target.value })}
                className="sr-only"
              />
              <div className="flex w-full items-start">
                <div className="flex items-center h-5">
                  <input
                    type="radio"
                    checked={data.coaTemplate === template.id}
                    onChange={() => {}}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                  />
                </div>
                <div className="ml-3 text-sm">
                  <span className="font-medium text-gray-900">{template.name}</span>
                  <p className="text-gray-500 mt-1">{template.description}</p>
                </div>
              </div>
            </label>
          ))}
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