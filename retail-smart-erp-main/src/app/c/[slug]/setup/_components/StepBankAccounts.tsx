'use client'

import { useState } from 'react'
import { Banknote, Plus, Trash2 } from 'lucide-react'
import { SriLankanBankSelect } from '@/components/ui/SriLankanBankSelect'

interface StepBankAccountsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (data: any) => void
  onNext: () => void
  onBack: () => void
}

export function StepBankAccounts({ data, onChange, onNext, onBack }: StepBankAccountsProps) {
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validate at least one bank account
    if (!data.bankAccounts || data.bankAccounts.length === 0) {
      setErrors({ general: 'Please add at least one bank account' })
      return
    }
    
    // Validate each account has a name
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invalidAccounts = data.bankAccounts.filter((account: any) => !account.accountName?.trim())
    if (invalidAccounts.length > 0) {
      setErrors({ general: 'All bank accounts must have a name' })
      return
    }
    
    onNext()
  }

  const addBankAccount = () => {
    const newAccount = {
      accountName: '',
      bankName: '',
      accountNumber: '',
      branchCode: '',
      isDefault: !data.bankAccounts || data.bankAccounts.length === 0
    }
    
    const updatedAccounts = [...(data.bankAccounts || []), newAccount]
    onChange({ ...data, bankAccounts: updatedAccounts })
    setErrors({})
  }

  const updateAccount = (index: number, field: string, value: string | boolean) => {
    const updatedAccounts = [...(data.bankAccounts || [])]
    updatedAccounts[index] = { ...updatedAccounts[index], [field]: value }
    
    // If setting as default, ensure only one is default
    if (field === 'isDefault' && value === true) {
      updatedAccounts.forEach((account, i) => {
        if (i !== index) account.isDefault = false
      })
    }
    
    onChange({ ...data, bankAccounts: updatedAccounts })
    setErrors({})
  }

  const removeAccount = (index: number) => {
    const updatedAccounts = [...(data.bankAccounts || [])]
    const wasDefault = updatedAccounts[index].isDefault
    updatedAccounts.splice(index, 1)
    
    // If we removed the default account and there are other accounts, set the first one as default
    if (wasDefault && updatedAccounts.length > 0) {
      updatedAccounts[0].isDefault = true
    }
    
    onChange({ ...data, bankAccounts: updatedAccounts })
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Bank Accounts</h2>
        <p className="text-gray-600">
          Add your company&apos;s bank accounts. These will be used for payments and receipts.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Error message */}
        {errors.general && (
          <div className="p-4 bg-red-50 border border-red-200 rounded">
            <p className="text-sm text-red-700">{errors.general}</p>
          </div>
        )}

        {/* Add account button */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={addBankAccount}
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <Plus size={16} className="mr-2" />
            Add Bank Account
          </button>
        </div>

        {/* Bank accounts list */}
        {(!data.bankAccounts || data.bankAccounts.length === 0) ? (
          <div className="text-center py-12 border-2 border-dashed border-gray-300 rounded">
            <Banknote size={48} className="mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No bank accounts added</h3>
            <p className="text-gray-500 mb-4">
              Add at least one bank account to continue
            </p>
            <button
              type="button"
              onClick={addBankAccount}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <Plus size={16} className="mr-2" />
              Add Your First Account
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {data.bankAccounts.map((account: any, index: number) => (
              <div key={index} className="border border-gray-200 rounded p-4 bg-white">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center space-x-2">
                    {account.isDefault && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Default
                      </span>
                    )}
                    <h4 className="text-lg font-medium text-gray-900">
                      {account.accountName || `Account ${index + 1}`}
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAccount(index)}
                    className="text-red-600 hover:text-red-900"
                    disabled={data.bankAccounts.length === 1}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Account Name *
                    </label>
                    <input
                      type="text"
                      value={account.accountName || ''}
                      onChange={(e) => updateAccount(index, 'accountName', e.target.value)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Main Business Account"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Bank Name
                    </label>
                    <SriLankanBankSelect
                      value={account.bankName || ''}
                      onChange={(name) => updateAccount(index, 'bankName', name)}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Account Number
                    </label>
                    <input
                      type="text"
                      value={account.accountNumber || ''}
                      onChange={(e) => updateAccount(index, 'accountNumber', e.target.value)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="1234567890"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Branch Code
                    </label>
                    <input
                      type="text"
                      value={account.branchCode || ''}
                      onChange={(e) => updateAccount(index, 'branchCode', e.target.value)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="1234"
                    />
                  </div>
                </div>

                <div className="mt-4 flex items-center">
                  <input
                    type="checkbox"
                    id={`default-${index}`}
                    checked={account.isDefault || false}
                    onChange={(e) => updateAccount(index, 'isDefault', e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor={`default-${index}`} className="ml-2 block text-sm text-gray-700">
                    Set as default account for payments and receipts
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Information box */}
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
          <h3 className="text-sm font-medium text-blue-800 mb-2">Bank Account Information</h3>
          <p className="text-sm text-blue-700">
            You can add multiple bank accounts. The default account will be used as the primary account
            for all payments and receipts. You can change this later in the accounting settings.
          </p>
        </div>

        {/* Actions */}
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