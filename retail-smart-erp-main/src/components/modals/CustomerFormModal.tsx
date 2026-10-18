'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { FormInput, FormSelect, FormTextarea, FormLabel } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { User, Phone, MapPin, Building2, FileText } from 'lucide-react'
import { useTerminology } from '@/hooks'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'

interface Customer {
  id: string
  name: string
  firstName: string | null
  lastName: string | null
  companyName: string | null
  email: string | null
  phone: string | null
  mobilePhone: string | null
  alternatePhone: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  useSameBillingAddress: boolean
  billingAddressLine1: string | null
  billingAddressLine2: string | null
  billingCity: string | null
  billingState: string | null
  billingPostalCode: string | null
  billingCountry: string | null
  taxId: string | null
  taxExempt: boolean
  businessType: 'individual' | 'company'
  creditLimit: string | null
  paymentTerms: string | null
  defaultPaymentMethod: string | null
  customerType: 'retail' | 'wholesale' | 'vip'
  referralSource: string | null
  marketingOptIn: boolean
  birthday: string | null
  notes: string | null
  specialInstructions: string | null
  driverLicenseNumber: string | null
  paymentTermsTemplateId: string | null
}

interface CustomerFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: (customer: { id: string; name: string; phone: string | null; email: string | null }) => void
  editCustomer?: Customer | null
  initialName?: string
}

const initialFormData = {
  firstName: '',
  lastName: '',
  companyName: '',
  email: '',
  phone: '',
  mobilePhone: '',
  alternatePhone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  useSameBillingAddress: true,
  billingAddressLine1: '',
  billingAddressLine2: '',
  billingCity: '',
  billingState: '',
  billingPostalCode: '',
  billingCountry: '',
  taxId: '',
  taxExempt: false,
  businessType: 'individual' as 'individual' | 'company',
  creditLimit: '',
  paymentTerms: '',
  defaultPaymentMethod: '',
  customerType: 'retail' as 'retail' | 'wholesale' | 'vip',
  referralSource: '',
  marketingOptIn: false,
  birthday: '',
  notes: '',
  specialInstructions: '',
  driverLicenseNumber: '',
  paymentTermsTemplateId: '',
}

type TabType = 'basic' | 'contact' | 'address' | 'business' | 'notes'

export function CustomerFormModal({ isOpen, onClose, onSaved, editCustomer, initialName = '' }: CustomerFormModalProps) {
  const t = useTerminology()
  const company = useCompanyOptional()
  const isAutoService = company?.businessType === 'auto_service' || company?.businessType === 'dealership'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<TabType>('basic')
  const [formData, setFormData] = useState(initialFormData)
  const [paymentTemplates, setPaymentTemplates] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    if (isOpen) {
      fetch('/api/accounting/payment-terms-templates?all=true')
        .then((r) => r.json())
        .then((data) => setPaymentTemplates(Array.isArray(data) ? data : data.data || []))
        .catch(() => {})
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen) {
      if (editCustomer) {
        setFormData({
          firstName: editCustomer.firstName || '',
          lastName: editCustomer.lastName || '',
          companyName: editCustomer.companyName || '',
          email: editCustomer.email || '',
          phone: editCustomer.phone || '',
          mobilePhone: editCustomer.mobilePhone || '',
          alternatePhone: editCustomer.alternatePhone || '',
          addressLine1: editCustomer.addressLine1 || '',
          addressLine2: editCustomer.addressLine2 || '',
          city: editCustomer.city || '',
          state: editCustomer.state || '',
          postalCode: editCustomer.postalCode || '',
          country: editCustomer.country || '',
          useSameBillingAddress: editCustomer.useSameBillingAddress ?? true,
          billingAddressLine1: editCustomer.billingAddressLine1 || '',
          billingAddressLine2: editCustomer.billingAddressLine2 || '',
          billingCity: editCustomer.billingCity || '',
          billingState: editCustomer.billingState || '',
          billingPostalCode: editCustomer.billingPostalCode || '',
          billingCountry: editCustomer.billingCountry || '',
          taxId: editCustomer.taxId || '',
          taxExempt: editCustomer.taxExempt || false,
          businessType: editCustomer.businessType || 'individual',
          creditLimit: editCustomer.creditLimit || '',
          paymentTerms: editCustomer.paymentTerms || '',
          defaultPaymentMethod: editCustomer.defaultPaymentMethod || '',
          customerType: editCustomer.customerType || 'retail',
          referralSource: editCustomer.referralSource || '',
          marketingOptIn: editCustomer.marketingOptIn || false,
          birthday: editCustomer.birthday || '',
          notes: editCustomer.notes || '',
          specialInstructions: editCustomer.specialInstructions || '',
          driverLicenseNumber: editCustomer.driverLicenseNumber || '',
          paymentTermsTemplateId: editCustomer.paymentTermsTemplateId || '',
        })
      } else {
        // Parse initialName for first/last name
        const nameParts = initialName.trim().split(' ')
        setFormData({
          ...initialFormData,
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' ') || '',
        })
      }
      setActiveTab('basic')
      setError('')
    }
  }, [isOpen, editCustomer, initialName])

  function handleClose() {
    setFormData(initialFormData)
    setError('')
    setActiveTab('basic')
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Generate display name
    let name = ''
    if (formData.businessType === 'company' && formData.companyName) {
      name = formData.companyName
    } else {
      name = [formData.firstName, formData.lastName].filter(Boolean).join(' ')
    }

    if (!name) {
      setError('Please enter a name')
      return
    }

    setSaving(true)
    setError('')

    try {
      const url = editCustomer ? `/api/customers/${editCustomer.id}` : '/api/customers'
      const method = editCustomer ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          name,
          creditLimit: formData.creditLimit ? parseFloat(formData.creditLimit) : null,
          birthday: formData.birthday || null,
          paymentTermsTemplateId: formData.paymentTermsTemplateId || null,
        }),
      })

      if (res.ok) {
        const customer = await res.json()
        toast.success(editCustomer ? `${t.customer} updated` : `${t.customer} created`)
        onSaved(customer)
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save customer')
      }
    } catch {
      setError('Failed to save customer')
    } finally {
      setSaving(false)
    }
  }

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'basic', label: 'Basic', icon: <User size={16} /> },
    { key: 'contact', label: 'Contact', icon: <Phone size={16} /> },
    { key: 'address', label: 'Address', icon: <MapPin size={16} /> },
    { key: 'business', label: 'Business', icon: <Building2 size={16} /> },
    { key: 'notes', label: 'Notes', icon: <FileText size={16} /> },
  ]

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={editCustomer ? `Edit ${t.customer}` : t.newCustomer} size="2xl">
      <form onSubmit={handleSubmit} className="flex flex-col h-full">
        {error && (
          <div className="p-3 mb-4 bg-red-50 text-red-600 rounded text-sm dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b dark:border-gray-700 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto min-h-[300px] max-h-[50vh]">
          {/* Basic Info Tab */}
          {activeTab === 'basic' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <FormLabel>Type</FormLabel>
                  <FormSelect
                    value={formData.businessType}
                    onChange={(e) => setFormData({ ...formData, businessType: e.target.value as 'individual' | 'company' })}
                  >
                    <option value="individual">Individual</option>
                    <option value="company">Company</option>
                  </FormSelect>
                </div>
                {formData.businessType === 'individual' ? (
                  <>
                    <div>
                      <FormLabel required>First Name</FormLabel>
                      <FormInput
                        type="text"
                        value={formData.firstName}
                        onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                        autoFocus
                      />
                    </div>
                    <div>
                      <FormLabel>Last Name</FormLabel>
                      <FormInput
                        type="text"
                        value={formData.lastName}
                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                      />
                    </div>
                    <div>
                      <FormLabel>Birthday</FormLabel>
                      <FormInput
                        type="date"
                        value={formData.birthday}
                        onChange={(e) => setFormData({ ...formData, birthday: e.target.value })}
                      />
                    </div>
                  </>
                ) : (
                  <div className="md:col-span-3">
                    <FormLabel required>Company Name</FormLabel>
                    <FormInput
                      type="text"
                      value={formData.companyName}
                      onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                      autoFocus
                    />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <FormLabel>Customer Type</FormLabel>
                  <FormSelect
                    value={formData.customerType}
                    onChange={(e) => setFormData({ ...formData, customerType: e.target.value as 'retail' | 'wholesale' | 'vip' })}
                  >
                    <option value="retail">Retail</option>
                    <option value="wholesale">Wholesale</option>
                    <option value="vip">VIP</option>
                  </FormSelect>
                </div>
                <div>
                  <FormLabel>Tax ID / VAT</FormLabel>
                  <FormInput
                    type="text"
                    value={formData.taxId}
                    onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                  />
                </div>
                {isAutoService && (
                  <div>
                    <FormLabel>Driver License #</FormLabel>
                    <FormInput
                      type="text"
                      value={formData.driverLicenseNumber}
                      onChange={(e) => setFormData({ ...formData, driverLicenseNumber: e.target.value })}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Contact Tab */}
          {activeTab === 'contact' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <FormLabel>Email</FormLabel>
                <FormInput
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div>
                <FormLabel>Phone</FormLabel>
                <FormInput
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
              <div>
                <FormLabel>Mobile Phone</FormLabel>
                <FormInput
                  type="tel"
                  value={formData.mobilePhone}
                  onChange={(e) => setFormData({ ...formData, mobilePhone: e.target.value })}
                />
              </div>
              <div>
                <FormLabel>Alternate Phone</FormLabel>
                <FormInput
                  type="tel"
                  value={formData.alternatePhone}
                  onChange={(e) => setFormData({ ...formData, alternatePhone: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <FormLabel>Referral Source</FormLabel>
                <FormInput
                  type="text"
                  value={formData.referralSource}
                  onChange={(e) => setFormData({ ...formData, referralSource: e.target.value })}
                  placeholder="How did they find you?"
                />
              </div>
              <div className="md:col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.marketingOptIn}
                    onChange={(e) => setFormData({ ...formData, marketingOptIn: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium dark:text-gray-200">Opted in for marketing communications</span>
                </label>
              </div>
            </div>
          )}

          {/* Address Tab */}
          {activeTab === 'address' && (
            <div className="space-y-6">
              {/* Primary Address */}
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 dark:text-gray-400">Primary Address</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <FormLabel>Address Line 1</FormLabel>
                    <FormInput
                      type="text"
                      value={formData.addressLine1}
                      onChange={(e) => setFormData({ ...formData, addressLine1: e.target.value })}
                    />
                  </div>
                  <div>
                    <FormLabel>Address Line 2</FormLabel>
                    <FormInput
                      type="text"
                      value={formData.addressLine2}
                      onChange={(e) => setFormData({ ...formData, addressLine2: e.target.value })}
                    />
                  </div>
                  <div>
                    <FormLabel>City</FormLabel>
                    <FormInput
                      type="text"
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    />
                  </div>
                  <div>
                    <FormLabel>State/Province</FormLabel>
                    <FormInput
                      type="text"
                      value={formData.state}
                      onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    />
                  </div>
                  <div>
                    <FormLabel>Postal Code</FormLabel>
                    <FormInput
                      type="text"
                      value={formData.postalCode}
                      onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                    />
                  </div>
                  <div>
                    <FormLabel>Country</FormLabel>
                    <FormInput
                      type="text"
                      value={formData.country}
                      onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Billing Address */}
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-gray-400">Billing Address</h3>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.useSameBillingAddress}
                      onChange={(e) => setFormData({ ...formData, useSameBillingAddress: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Same as primary</span>
                  </label>
                </div>
                {!formData.useSameBillingAddress && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <FormLabel>Address Line 1</FormLabel>
                      <FormInput
                        type="text"
                        value={formData.billingAddressLine1}
                        onChange={(e) => setFormData({ ...formData, billingAddressLine1: e.target.value })}
                      />
                    </div>
                    <div>
                      <FormLabel>Address Line 2</FormLabel>
                      <FormInput
                        type="text"
                        value={formData.billingAddressLine2}
                        onChange={(e) => setFormData({ ...formData, billingAddressLine2: e.target.value })}
                      />
                    </div>
                    <div>
                      <FormLabel>City</FormLabel>
                      <FormInput
                        type="text"
                        value={formData.billingCity}
                        onChange={(e) => setFormData({ ...formData, billingCity: e.target.value })}
                      />
                    </div>
                    <div>
                      <FormLabel>State/Province</FormLabel>
                      <FormInput
                        type="text"
                        value={formData.billingState}
                        onChange={(e) => setFormData({ ...formData, billingState: e.target.value })}
                      />
                    </div>
                    <div>
                      <FormLabel>Postal Code</FormLabel>
                      <FormInput
                        type="text"
                        value={formData.billingPostalCode}
                        onChange={(e) => setFormData({ ...formData, billingPostalCode: e.target.value })}
                      />
                    </div>
                    <div>
                      <FormLabel>Country</FormLabel>
                      <FormInput
                        type="text"
                        value={formData.billingCountry}
                        onChange={(e) => setFormData({ ...formData, billingCountry: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Business Tab */}
          {activeTab === 'business' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <FormLabel>Credit Limit</FormLabel>
                <FormInput
                  type="number"
                  step="0.01"
                  value={formData.creditLimit}
                  onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })}
                />
              </div>
              <div>
                <FormLabel>Payment Terms</FormLabel>
                <FormSelect
                  value={formData.paymentTerms}
                  onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="COD">COD (Cash on Delivery)</option>
                  <option value="Due on Receipt">Due on Receipt</option>
                  <option value="Net 7">Net 7</option>
                  <option value="Net 15">Net 15</option>
                  <option value="Net 30">Net 30</option>
                  <option value="Net 60">Net 60</option>
                </FormSelect>
              </div>
              <div>
                <FormLabel>Default Payment Method</FormLabel>
                <FormSelect
                  value={formData.defaultPaymentMethod}
                  onChange={(e) => setFormData({ ...formData, defaultPaymentMethod: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="credit">Store Credit</option>
                  <option value="bank_transfer">Bank Transfer</option>
                </FormSelect>
              </div>
              {paymentTemplates.length > 0 && (
                <div>
                  <FormLabel>Payment Terms Template</FormLabel>
                  <FormSelect
                    value={formData.paymentTermsTemplateId}
                    onChange={(e) => setFormData({ ...formData, paymentTermsTemplateId: e.target.value })}
                  >
                    <option value="">Select...</option>
                    {paymentTemplates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                    ))}
                  </FormSelect>
                </div>
              )}
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.taxExempt}
                    onChange={(e) => setFormData({ ...formData, taxExempt: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium dark:text-gray-200">Tax Exempt</span>
                </label>
              </div>
            </div>
          )}

          {/* Notes Tab */}
          {activeTab === 'notes' && (
            <div className="space-y-4">
              <div>
                <FormLabel>General Notes</FormLabel>
                <FormTextarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={4}
                  placeholder="General notes about this customer..."
                />
              </div>
              <div>
                <FormLabel>Special Instructions</FormLabel>
                <FormTextarea
                  value={formData.specialInstructions}
                  onChange={(e) => setFormData({ ...formData, specialInstructions: e.target.value })}
                  rows={4}
                  placeholder="Special handling instructions, preferences, etc..."
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-4 mt-4 border-t dark:border-gray-700">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 dark:text-gray-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : editCustomer ? `Update ${t.customer}` : `Create ${t.customer}`}
          </button>
        </div>
      </form>
    </Modal>
  )
}
