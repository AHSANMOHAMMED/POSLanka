import { render, screen, fireEvent } from '@testing-library/react'
import { RetailConfig } from '../RetailConfig'
import React from 'react'

describe('RetailConfig', () => {
  const mockOnChange = jest.fn()
  const mockOnDismiss = jest.fn()

  const defaultProps = {
    data: {
      selectedCategories: ['Electronics', 'Clothing'],
      coaTemplate: 'numbered' as const,
      paymentMethods: ['cash'],
      posProfileName: 'Default POS',
      receiptFormat: '80mm',
    },
    onChange: mockOnChange,
    suggestions: null,
    suggestionsLoading: false,
    dismissed: new Set<string>(),
    onDismiss: mockOnDismiss,
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the component with categories', () => {
    render(<RetailConfig {...defaultProps} />)

    expect(screen.getByText('Product Categories')).toBeInTheDocument()
    expect(screen.getByText('Select the categories you want to start with. You can add more later.')).toBeInTheDocument()
    
    // Check for some category checkboxes
    expect(screen.getByLabelText('Electronics')).toBeInTheDocument()
    expect(screen.getByLabelText('Clothing')).toBeInTheDocument()
  })

  it('toggles a category when clicked', () => {
    render(<RetailConfig {...defaultProps} />)

    const electronicsCheckbox = screen.getByLabelText('Electronics')
    fireEvent.click(electronicsCheckbox)

    expect(mockOnChange).toHaveBeenCalledWith({
      selectedCategories: ['Clothing'] // Electronics should be removed
    })
  })

  it('adds a custom category', () => {
    render(<RetailConfig {...defaultProps} />)

    const input = screen.getByPlaceholderText('Add custom category...')
    const addButton = screen.getByRole('button', { name: /add/i })

    // Type a new category
    fireEvent.change(input, { target: { value: 'Books' } })
    fireEvent.click(addButton)

    expect(mockOnChange).toHaveBeenCalledWith({
      selectedCategories: ['Electronics', 'Clothing', 'Books']
    })
    expect(input).toHaveValue('') // Input should be cleared
  })

  it('adds a custom category by pressing Enter', () => {
    render(<RetailConfig {...defaultProps} />)

    const input = screen.getByPlaceholderText('Add custom category...')
    
    fireEvent.change(input, { target: { value: 'Books' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(mockOnChange).toHaveBeenCalledWith({
      selectedCategories: ['Electronics', 'Clothing', 'Books']
    })
  })

  it('does not add empty custom category', () => {
    render(<RetailConfig {...defaultProps} />)

    const input = screen.getByPlaceholderText('Add custom category...')
    const addButton = screen.getByRole('button', { name: /add/i })

    // Try to add empty category
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(addButton)

    expect(mockOnChange).not.toHaveBeenCalled()
  })

  it('does not add duplicate custom category', () => {
    render(<RetailConfig {...defaultProps} />)

    const input = screen.getByPlaceholderText('Add custom category...')
    const addButton = screen.getByRole('button', { name: /add/i })

    // Try to add existing category
    fireEvent.change(input, { target: { value: 'Electronics' } })
    fireEvent.click(addButton)

    expect(mockOnChange).not.toHaveBeenCalled()
  })

  it('shows AI suggestion banner when not dismissed', () => {
    const propsWithSuggestions = {
      ...defaultProps,
      suggestions: {
        suggestedCategories: ['Toys', 'Home Appliances']
      }
    }

    render(<RetailConfig {...propsWithSuggestions} />)

    expect(screen.getByText(/AI suggestion/i)).toBeInTheDocument()
    expect(screen.getByText('Toys')).toBeInTheDocument()
    expect(screen.getByText('Home Appliances')).toBeInTheDocument()
  })

  it('does not show AI suggestion banner when dismissed', () => {
    const propsWithDismissed = {
      ...defaultProps,
      dismissed: new Set<string>(['categories']),
      suggestions: {
        suggestedCategories: ['Toys', 'Home Appliances']
      }
    }

    render(<RetailConfig {...propsWithDismissed} />)

    expect(screen.queryByText(/AI suggestion/i)).not.toBeInTheDocument()
  })

  it('applies all AI suggestions when apply button is clicked', () => {
    const propsWithSuggestions = {
      ...defaultProps,
      suggestions: {
        suggestedCategories: ['Toys', 'Home Appliances']
      }
    }

    render(<RetailConfig {...propsWithSuggestions} />)

    const applyButton = screen.getByText(/Apply all/i)
    fireEvent.click(applyButton)

    expect(mockOnChange).toHaveBeenCalledWith({
      selectedCategories: ['Toys', 'Home Appliances']
    })
  })

  it('removes custom category tag when X is clicked', () => {
    // Add a custom category first
    const propsWithCustomCategory = {
      ...defaultProps,
      data: {
        ...defaultProps.data,
        selectedCategories: ['Electronics', 'Clothing', 'CustomCategory']
      }
    }

    render(<RetailConfig {...propsWithCustomCategory} />)

    // Find and click the X button on the custom category tag
    const customCategoryTag = screen.getByText('CustomCategory')
    const removeButton = customCategoryTag.parentElement?.querySelector('button')
    
    if (removeButton) {
      fireEvent.click(removeButton)
    }

    expect(mockOnChange).toHaveBeenCalledWith({
      selectedCategories: ['Electronics', 'Clothing']
    })
  })
})
