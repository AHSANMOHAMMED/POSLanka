'use client'

import { useState } from 'react'
import { Building2, Users, Calendar, Banknote } from 'lucide-react'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'

interface StepEmployeesProps {
  data: SetupWizardData
  companySlug: string
  businessType: string
  country: string
  countryName: string
  currency: string
  companyName: string
  onChange: (updates: Partial<SetupWizardData>) => void
  onNext: () => void
  onBack: () => void
}

export function StepEmployees({
  data,
  companySlug: _companySlug,
  businessType: _businessType,
  country: _country,
  countryName: _countryName,
  currency: _currency,
  companyName: _companyName,
  onChange,
  onNext,
  onBack,
}: StepEmployeesProps) {
  const [employeeStructure, setEmployeeStructure] = useState(data.employeeStructure || 'basic')
  const [payrollCycle, setPayrollCycle] = useState(data.payrollCycle || 'monthly')
  const [leavePolicy, setLeavePolicy] = useState(data.leavePolicy || 'standard')
  const [salaryStructure, setSalaryStructure] = useState(data.defaultSalaryStructure || 'fixed')

  // Update local state when employeeStructure changes from 'none' to something else
  const handleEmployeeStructureChange = (value: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setEmployeeStructure(value as any)
    // If changing from 'none' to another option, reset other fields to defaults
    if (employeeStructure === 'none' && value !== 'none') {
      setPayrollCycle('monthly')
      setLeavePolicy('standard')
      setSalaryStructure('fixed')
    }
  }

  const handleNext = () => {
    if (employeeStructure === 'none') {
      onChange({
        employeeStructure: 'none',
        // Clear other fields when skipping
        payrollCycle: undefined,
        leavePolicy: undefined,
        defaultSalaryStructure: undefined,
      })
    } else {
      onChange({
        employeeStructure,
        payrollCycle,
        leavePolicy,
        defaultSalaryStructure: salaryStructure,
      })
    }
    onNext()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Employees & HR Setup</h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Configure your employee structure, payroll, and leave policies.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="bg-gray-50 dark:bg-slate-700/50 p-4 rounded border">
            <div className="flex items-center gap-3 mb-3">
              <Building2 className="h-5 w-5 text-blue-600" />
              <h3 className="font-semibold text-gray-900 dark:text-white">Employee Structure</h3>
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="structure"
                  value="basic"
                  checked={employeeStructure === 'basic'}
                  onChange={(e) => handleEmployeeStructureChange(e.target.value)}
                  className="h-4 w-4 text-blue-600"
                />
                <div>
                  <div className="font-medium">Basic</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Simple hierarchy with Admin, Manager, and Staff roles
                  </div>
                </div>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="structure"
                  value="advanced"
                  checked={employeeStructure === 'advanced'}
                  onChange={(e) => handleEmployeeStructureChange(e.target.value)}
                  className="h-4 w-4 text-blue-600"
                />
                <div>
                  <div className="font-medium">Advanced</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Multiple departments, custom roles, and permissions
                  </div>
                </div>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="structure"
                  value="none"
                  checked={employeeStructure === 'none'}
                  onChange={(e) => handleEmployeeStructureChange(e.target.value)}
                  className="h-4 w-4 text-blue-600"
                />
                <div>
                  <div className="font-medium">Skip for now</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Set up employees later
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-slate-700/50 p-4 rounded border">
            <div className="flex items-center gap-3 mb-3">
              <Banknote className="h-5 w-5 text-green-600" />
              <h3 className="font-semibold text-gray-900 dark:text-white">Salary Structure</h3>
            </div>
            <select
              value={salaryStructure}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onChange={(e) => setSalaryStructure(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700"
            >
              <option value="fixed">Fixed Salary Only</option>
              <option value="commission">Commission Only</option>
              <option value="hybrid">Fixed + Commission</option>
            </select>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-gray-50 dark:bg-slate-700/50 p-4 rounded border">
            <div className="flex items-center gap-3 mb-3">
              <Calendar className="h-5 w-5 text-purple-600" />
              <h3 className="font-semibold text-gray-900 dark:text-white">Payroll Cycle</h3>
            </div>
            <div className="space-y-3">
              {['weekly', 'biweekly', 'monthly'].map((cycle) => (
                <label key={cycle} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="payroll"
                    value={cycle}
                    checked={payrollCycle === cycle}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onChange={(e) => setPayrollCycle(e.target.value as any)}
                    className="h-4 w-4 text-blue-600"
                  />
                  <div>
                    <div className="font-medium capitalize">{cycle}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-slate-700/50 p-4 rounded border">
            <div className="flex items-center gap-3 mb-3">
              <Users className="h-5 w-5 text-amber-600" />
              <h3 className="font-semibold text-gray-900 dark:text-white">Leave Policy</h3>
            </div>
            <select
              value={leavePolicy}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onChange={(e) => setLeavePolicy(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700"
            >
              <option value="minimal">Minimal (10 days/year)</option>
              <option value="standard">Standard (20 days/year)</option>
              <option value="generous">Generous (30 days/year)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex justify-between pt-6 border-t">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2.5 border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          className="px-6 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Next: Sales Commissions
        </button>
      </div>
    </div>
  )
}
