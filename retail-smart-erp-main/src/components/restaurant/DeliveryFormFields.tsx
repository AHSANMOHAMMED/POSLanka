'use client'

interface DeliveryFormFieldsProps {
  address: string
  phone: string
  notes: string
  driverName: string
  driverPhone: string
  estimatedTime: string
  deliveryFee: string
  onChange: (field: string, value: string) => void
  showDriverFields?: boolean
}

const inputClass = "w-full px-3 py-2 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"

export function DeliveryFormFields({
  address, phone, notes, driverName, driverPhone, estimatedTime, deliveryFee,
  onChange, showDriverFields = false,
}: DeliveryFormFieldsProps) {
  return (
    <div className="space-y-4 border-t pt-4 mt-4">
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Delivery Details</h4>

      <div>
        <label className="block text-sm font-medium mb-1 dark:text-gray-300">Delivery Address *</label>
        <textarea
          value={address}
          onChange={e => onChange('deliveryAddress', e.target.value)}
          rows={2}
          className={inputClass}
          placeholder="Enter delivery address"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1 dark:text-gray-300">Phone</label>
          <input
            value={phone}
            onChange={e => onChange('deliveryPhone', e.target.value)}
            placeholder="Contact phone"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 dark:text-gray-300">Delivery Fee</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={deliveryFee}
            onChange={e => onChange('deliveryFee', e.target.value)}
            placeholder="0.00"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1 dark:text-gray-300">Delivery Notes</label>
        <input
          value={notes}
          onChange={e => onChange('deliveryNotes', e.target.value)}
          placeholder="Special instructions..."
          className={inputClass}
        />
      </div>

      {showDriverFields && (
        <>
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mt-4">Driver Info</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">Driver Name</label>
              <input
                value={driverName}
                onChange={e => onChange('driverName', e.target.value)}
                placeholder="Driver name"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">Driver Phone</label>
              <input
                value={driverPhone}
                onChange={e => onChange('driverPhone', e.target.value)}
                placeholder="Driver phone"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Estimated Delivery Time</label>
            <input
              type="datetime-local"
              value={estimatedTime}
              onChange={e => onChange('estimatedDeliveryTime', e.target.value)}
              className={inputClass}
            />
          </div>
        </>
      )}
    </div>
  )
}
