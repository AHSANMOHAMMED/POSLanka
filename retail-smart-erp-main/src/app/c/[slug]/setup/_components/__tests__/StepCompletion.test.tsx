import { render, screen } from '@testing-library/react'
import { StepCompletion } from '../StepCompletion'
import React from 'react'

// Mock data
const mockWizardData = {
  warehouses: [{ name: 'Main Warehouse', code: 'MAIN', isDefault: true }],
  selectedCategories: ['Electronics', 'Clothing'],
  paymentMethods: ['cash', 'card'],
  coaTemplate: 'numbered' as const,
  fiscalYearStart: '2024-01-01',
  fiscalYearEnd: '2024-12-31',
  costCenters: ['Main'],
  defaultCostCenter: 'Main',
  bankAccounts: [],
  enableLoyalty: false,
  enableNotifications: false,
  posProfileName: 'Default POS',
  receiptFormat: '80mm',
  teamInvites: [],
}

describe('StepCompletion', () => {
  it('renders loading state when completing', () => {
    render(
      <StepCompletion
        completing={true}
        completed={false}
        wizardData={mockWizardData}
        businessType="retail"
        onGoToDashboard={jest.fn()}
        onRetry={jest.fn()}
        onBack={jest.fn()}
      />
    )

    expect(screen.getByText('Setting up your business...')).toBeInTheDocument()
    expect(screen.getByText('This will only take a moment.')).toBeInTheDocument()
  })

  it('renders completed state when completed', () => {
    render(
      <StepCompletion
        completing={false}
        completed={true}
        wizardData={mockWizardData}
        businessType="retail"
        onGoToDashboard={jest.fn()}
        onRetry={jest.fn()}
        onBack={jest.fn()}
      />
    )

    expect(screen.getByText("You're all set!")).toBeInTheDocument()
    expect(screen.getByText('Your business has been configured and is ready to use.')).toBeInTheDocument()
  })

  it('renders error state when error is provided', () => {
    render(
      <StepCompletion
        completing={false}
        completed={false}
        error="Setup failed"
        wizardData={mockWizardData}
        businessType="retail"
        onGoToDashboard={jest.fn()}
        onRetry={jest.fn()}
        onBack={jest.fn()}
      />
    )

    expect(screen.getByText('Setup Failed')).toBeInTheDocument()
    expect(screen.getByText('Setup failed')).toBeInTheDocument()
  })

  it('shows progress steps for retail business type', () => {
    render(
      <StepCompletion
        completing={true}
        completed={false}
        wizardData={mockWizardData}
        businessType="retail"
        onGoToDashboard={jest.fn()}
        onRetry={jest.fn()}
        onBack={jest.fn()}
      />
    )

    // Check for some expected progress steps
    expect(screen.getByText('Creating default warehouse...')).toBeInTheDocument()
    expect(screen.getByText('Adding categories...')).toBeInTheDocument()
    expect(screen.getByText('Setting up POS profile...')).toBeInTheDocument()
  })

  it('shows restaurant-specific steps for restaurant business type', () => {
    const restaurantData = {
      ...mockWizardData,
      numberOfTables: 10,
    }

    render(
      <StepCompletion
        completing={true}
        completed={false}
        wizardData={restaurantData}
        businessType="restaurant"
        onGoToDashboard={jest.fn()}
        onRetry={jest.fn()}
        onBack={jest.fn()}
      />
    )

    expect(screen.getByText('Creating restaurant tables...')).toBeInTheDocument()
  })

  it('shows auto service-specific steps for auto_service business type', () => {
    const autoServiceData = {
      ...mockWizardData,
      selectedServiceGroups: [{ name: 'Maintenance', description: 'Basic maintenance', services: [] }],
    }

    render(
      <StepCompletion
        completing={true}
        completed={false}
        wizardData={autoServiceData}
        businessType="auto_service"
        onGoToDashboard={jest.fn()}
        onRetry={jest.fn()}
        onBack={jest.fn()}
      />
    )

    expect(screen.getByText('Setting up service types...')).toBeInTheDocument()
    expect(screen.getByText('Seeding vehicle data...')).toBeInTheDocument()
  })
})
