'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, Building2, Phone, Mail, CheckCircle } from 'lucide-react'
import { usePaginatedData } from '@/hooks'
import {
  Pagination,
  StatusBadge,
  EmptyState,
  Button,
  ConfirmModal,
} from '@/components/ui'
import { InsuranceCompanyFormModal } from '@/components/modals'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

interface InsuranceCompany {
  id: string
  name: string
  shortName: string | null
  phone: string | null
  email: string | null
  claimHotline: string | null
  isPartnerGarage: boolean
  estimateThreshold: string | null
  isActive: boolean
  createdAt: string
}

// Sri Lankan licensed general insurance companies (Source: IRCSL - ircsl.gov.lk)
const SRI_LANKAN_INSURERS = [
  { name: 'Sri Lanka Insurance Corporation General', shortName: 'SLIC', claimHotline: '011-2357357', email: '' },
  { name: 'Ceylinco General Insurance', shortName: 'Ceylinco', claimHotline: '011-4702702', email: 'ceylincoinsurance@ceyins.lk' },
  { name: 'Allianz Insurance Lanka', shortName: 'Allianz', claimHotline: '011-2303300', email: 'info.lk@allianz.com' },
  { name: "People's Insurance PLC", shortName: "People's", claimHotline: '011-2206306', email: 'pilassist@peoplesinsurance.lk' },
  { name: 'Fairfirst Insurance Limited', shortName: 'Fairfirst', claimHotline: '011-2428428', email: 'info@fairfirst.lk' },
  { name: 'LOLC General Insurance PLC', shortName: 'LOLC', claimHotline: '011-5008080', email: 'enquiry@lolcgeneral.com' },
  { name: 'Continental Insurance Lanka', shortName: 'Continental', claimHotline: '011-2800200', email: 'info@cilanka.com' },
  { name: 'HNB General Insurance', shortName: 'HNB', claimHotline: '1303', email: 'info@hnbgeneral.com' },
  { name: 'Orient Insurance Limited', shortName: 'Orient', claimHotline: '011-7454454', email: 'info@orientinsurance.lk' },
  { name: 'Cooperative Insurance Company PLC', shortName: 'CICL', claimHotline: '011-2557300', email: '' },
  { name: 'National Insurance Trust Fund', shortName: 'NITF', claimHotline: '011-4321600', email: 'mail@nitf.lk' },
  { name: 'Amana Takaful PLC', shortName: 'Amana', claimHotline: '011-7501000', email: 'info@takaful.lk' },
  { name: 'SANASA General Insurance Company', shortName: 'SANASA', claimHotline: '072-5575575', email: 'info@sgic.lk' },
]

export default function InsuranceCompaniesPage() {
  const [showModal, setShowModal] = useState(false)
  const [editingCompany, setEditingCompany] = useState<InsuranceCompany | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null; name: string }>({ open: false, id: null, name: '' })

  const {
    data: companies,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: fetchCompanies,
  } = usePaginatedData<InsuranceCompany>({
    endpoint: '/api/insurance-companies',
    entityType: ['insurance-company', 'insurance-assessor'],
    storageKey: 'insurance-companies-page-size',
  })

  async function seedSriLankanInsurers() {
    setSeeding(true)
    try {
      const allRes = await fetch('/api/insurance-companies?all=true')
      if (!allRes.ok) {
        toast.error('Failed to check existing companies')
        return
      }
      const allCompanies: InsuranceCompany[] = await allRes.json()
      const existingNames = allCompanies.map(c => c.name.toLowerCase())

      const toAdd = SRI_LANKAN_INSURERS.filter(
        insurer => !existingNames.includes(insurer.name.toLowerCase())
      )

      if (toAdd.length === 0) {
        toast.info('All Sri Lankan insurers already exist')
        return
      }

      for (const insurer of toAdd) {
        await fetch('/api/insurance-companies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(insurer),
        })
      }

      await fetchCompanies()
      toast.success(`Added ${toAdd.length} Sri Lankan insurance companies`)
    } catch (error) {
      console.error('Error seeding insurers:', error)
      toast.error('Failed to add insurers')
    } finally {
      setSeeding(false)
    }
  }

  async function handleDelete() {
    if (!deleteConfirm.id) return

    try {
      const res = await fetch(`/api/insurance-companies/${deleteConfirm.id}`, { method: 'DELETE' })
      if (res.ok) {
        fetchCompanies()
        toast.success('Insurance company deleted')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete insurance company')
      }
    } catch (error) {
      console.error('Error deleting insurance company:', error)
      toast.error('Failed to delete insurance company')
    } finally {
      setDeleteConfirm({ open: false, id: null, name: '' })
    }
  }

  function handleEdit(company: InsuranceCompany) {
    setEditingCompany(company)
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setEditingCompany(null)
  }

  if (loading && companies.length === 0) {
    return <PageLoading text="Loading insurance companies..." />
  }

  return (
    <ListPageLayout
      module="Auto Service"
      moduleHref="/auto-service"
      title="Insurance Company"
      actionContent={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={seedSriLankanInsurers}
            disabled={seeding}
          >
            <Building2 size={18} className="mr-1" />
            {seeding ? 'Adding...' : 'Add Sri Lankan Insurers'}
          </Button>
          <Button onClick={() => setShowModal(true)}>
            <Plus size={18} className="mr-1" />
            Add Company
          </Button>
        </div>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={fetchCompanies}
      searchPlaceholder="Search insurance companies..."
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl">
        <table className="w-full">
          <caption className="sr-only">List of insurance companies</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Company</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Contact</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Claim Hotline</th>
              <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Partner</th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Threshold</th>
              <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {companies.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    icon={<Building2 size={24} />}
                    title={search ? 'No insurance companies found' : 'No insurance companies yet'}
                    description={search ? 'Try adjusting your search terms' : 'Add Sri Lankan insurers or create your own'}
                    action={
                      !search && (
                        <Button onClick={() => setShowModal(true)} size="sm">
                          <Plus size={16} className="mr-1" />
                          Add Company
                        </Button>
                      )
                    }
                  />
                </td>
              </tr>
            ) : (
              companies.map((company) => (
                <tr key={company.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">{company.name}</div>
                        {company.shortName && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">{company.shortName}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      {company.phone && (
                        <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                          <Phone size={14} className="text-gray-400" />
                          <span>{company.phone}</span>
                        </div>
                      )}
                      {company.email && (
                        <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                          <Mail size={14} className="text-gray-400" />
                          <span>{company.email}</span>
                        </div>
                      )}
                      {!company.phone && !company.email && (
                        <span className="text-sm text-gray-400 dark:text-gray-500">-</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {company.claimHotline || '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {company.isPartnerGarage && (
                      <CheckCircle className="inline text-green-600 dark:text-green-400" size={18} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-400">
                    {company.estimateThreshold
                      ? `LKR ${parseFloat(company.estimateThreshold).toLocaleString()}`
                      : '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={company.isActive ? 'active' : 'inactive'} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleEdit(company)}
                      aria-label={`Edit ${company.name}`}
                      className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded transition-colors"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm({ open: true, id: company.id, name: company.name })}
                      aria-label={`Delete ${company.name}`}
                      className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded ml-1 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          className="border-t dark:border-gray-700 px-4 pagination-sticky"
        />
      </div>

      <InsuranceCompanyFormModal
        isOpen={showModal}
        onClose={handleCloseModal}
        onSaved={() => {
          fetchCompanies()
          handleCloseModal()
        }}
        editCompany={editingCompany}
      />

      <ConfirmModal
        isOpen={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: null, name: '' })}
        onConfirm={handleDelete}
        title="Delete Insurance Company"
        message={`Are you sure you want to delete "${deleteConfirm.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </ListPageLayout>
  )
}
