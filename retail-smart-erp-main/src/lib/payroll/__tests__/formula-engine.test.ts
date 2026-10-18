import {
  evaluateFormula,
  validateComponentAbbreviation,
  validateFormula,
  previewFormula,
  extractFormulaDependencies,
  detectCircularDependencies,
  type FormulaContext,
} from '../formula-engine'

describe('formula-engine', () => {
  describe('validateComponentAbbreviation', () => {
    test('valid abbreviations', () => {
      expect(validateComponentAbbreviation('BP')).toBeNull()
      expect(validateComponentAbbreviation('HRA')).toBeNull()
      expect(validateComponentAbbreviation('TAX')).toBeNull()
      expect(validateComponentAbbreviation('bonus_2024')).toBeNull()
      expect(validateComponentAbbreviation('_ALLOWANCE')).toBeNull()
    })

    test('invalid abbreviations', () => {
      expect(validateComponentAbbreviation('')).toBe('Abbreviation cannot be empty')
      expect(validateComponentAbbreviation('   ')).toBe('Abbreviation cannot be empty')
      expect(validateComponentAbbreviation('ABBREVIATION_THAT_IS_TOO_LONG_FOR_TEST')).toBe('Abbreviation must be 20 characters or less')
      expect(validateComponentAbbreviation('123BONUS')).toBe('Abbreviation must start with a letter or underscore and contain only letters, numbers, and underscores')
      expect(validateComponentAbbreviation('BONUS-2024')).toBe('Abbreviation must start with a letter or underscore and contain only letters, numbers, and underscores')
      expect(validateComponentAbbreviation('base')).toBe('Abbreviation "base" is a reserved variable name and cannot be used')
      expect(validateComponentAbbreviation('gross')).toBe('Abbreviation "gross" is a reserved variable name and cannot be used')
      expect(validateComponentAbbreviation('net')).toBe('Abbreviation "net" is a reserved variable name and cannot be used')
      expect(validateComponentAbbreviation('amount')).toBe('Abbreviation "amount" is a reserved variable name and cannot be used')
      expect(validateComponentAbbreviation('NaN')).toBe('Abbreviation "NaN" is a reserved variable name and cannot be used')
    })
  })

  describe('evaluateFormula', () => {
    const baseContext: FormulaContext = {
      base: 50000,
      gross: 60000,
      net: 55000,
      amount: 1000,
    }

    test('basic arithmetic', () => {
      expect(evaluateFormula('base * 0.08', baseContext)).toBe(4000)
      expect(evaluateFormula('base + gross', baseContext)).toBe(110000)
      expect(evaluateFormula('gross - base', baseContext)).toBe(10000)
      expect(evaluateFormula('base / 2', baseContext)).toBe(25000)
      expect(evaluateFormula('(base + gross) * 0.05', baseContext)).toBe(5500)
    })

    test('variable references', () => {
      const context = { ...baseContext, HRA: 5000, DA: 3000 }
      expect(evaluateFormula('HRA + DA', context)).toBe(8000)
      expect(evaluateFormula('base * 0.1 + HRA', context)).toBe(10000)
    })

    test('division by near-zero protection', () => {
      expect(() => evaluateFormula('base / 0.005', baseContext)).toThrow('Division by zero (or near-zero)')
      expect(() => evaluateFormula('base / 0.009', baseContext)).toThrow('Division by zero (or near-zero)')
      expect(evaluateFormula('base / 0.02', baseContext)).toBe(2500000) // 50000 / 0.02 = 2,500,000
    })

    test('division by zero exact', () => {
      expect(() => evaluateFormula('base / 0', baseContext)).toThrow('Division by zero (or near-zero)')
    })

    test('empty formula returns default amount', () => {
      expect(evaluateFormula('', baseContext)).toBe(1000)
      expect(evaluateFormula('   ', baseContext)).toBe(1000)
    })

    test('invalid formulas throw errors', () => {
      expect(() => evaluateFormula('base *', baseContext)).toThrow()
      expect(() => evaluateFormula('* base', baseContext)).toThrow()
      expect(() => evaluateFormula('base +', baseContext)).toThrow()
      expect(() => evaluateFormula('(base + gross', baseContext)).toThrow()
      expect(() => evaluateFormula('base + )', baseContext)).toThrow()
      expect(() => evaluateFormula('unknown_var * 2', baseContext)).toThrow('Unknown variable \'unknown_var\'')
    })

    test('rounding to 2 decimal places', () => {
      expect(evaluateFormula('base * 0.123456', baseContext)).toBe(6172.8) // 50000 * 0.123456 = 6172.8
      expect(evaluateFormula('base / 3', baseContext)).toBe(16666.67) // 50000 / 3 = 16666.666...
    })

    test('guard against NaN/Infinity', () => {
      const contextWithZero = { ...baseContext, base: 0 }
      expect(() => evaluateFormula('base / 0', contextWithZero)).toThrow('Division by zero (or near-zero)')
    })
  })

  describe('validateFormula', () => {
    test('valid formulas return null', () => {
      expect(validateFormula('base * 0.08')).toBeNull()
      expect(validateFormula('(base + gross) * 0.05')).toBeNull()
      expect(validateFormula('HRA + DA')).toBeNull()
      expect(validateFormula('')).toBeNull()
      expect(validateFormula('   ')).toBeNull()
    })

    test('invalid formulas return error message', () => {
      expect(validateFormula('base *')).not.toBeNull()
      expect(validateFormula('* base')).not.toBeNull()
      expect(validateFormula('base +')).not.toBeNull()
      expect(validateFormula('(base + gross')).not.toBeNull()
      expect(validateFormula('base + )')).not.toBeNull()
    })
  })

  describe('previewFormula', () => {
    test('valid formula preview', () => {
      const result = previewFormula('base * 0.08', 50000)
      expect(result.error).toBeNull()
      expect(result.result).toBe(4000)
    })

    test('with additional variables', () => {
      const result = previewFormula('base * 0.1 + HRA', 50000, { HRA: 5000 })
      expect(result.error).toBeNull()
      expect(result.result).toBe(10000)
    })

    test('invalid formula preview', () => {
      const result = previewFormula('base *', 50000)
      expect(result.result).toBeNull()
      expect(result.error).not.toBeNull()
    })
  })

  describe('extractFormulaDependencies', () => {
    test('extracts component dependencies', () => {
      expect(extractFormulaDependencies('HRA + DA')).toEqual(new Set(['HRA', 'DA']))
      expect(extractFormulaDependencies('base * 0.1 + HRA - DA')).toEqual(new Set(['HRA', 'DA']))
      expect(extractFormulaDependencies('(HRA * 0.5) + (DA * 0.3)')).toEqual(new Set(['HRA', 'DA']))
    })

    test('ignores reserved variables', () => {
      expect(extractFormulaDependencies('base * 0.1 + gross - net + amount')).toEqual(new Set())
      expect(extractFormulaDependencies('base + HRA + gross')).toEqual(new Set(['HRA']))
    })

    test('empty formula returns empty set', () => {
      expect(extractFormulaDependencies('')).toEqual(new Set())
      expect(extractFormulaDependencies('   ')).toEqual(new Set())
    })

    test('invalid formula returns empty set', () => {
      // extractFormulaDependencies should handle tokenization errors gracefully
      expect(extractFormulaDependencies('base *')).toEqual(new Set())
    })
  })

  describe('detectCircularDependencies', () => {
    test('no circular dependencies', () => {
      const formulas = new Map([
        ['HRA', 'base * 0.4'],
        ['DA', 'base * 0.2'],
        ['TAX', '(base + HRA + DA) * 0.1'],
        ['BONUS', '5000'], // constant
        ['ALLOWANCE', null], // no formula
      ])
      const errors = detectCircularDependencies(formulas)
      expect(errors).toEqual([])
    })

    test('simple circular dependency', () => {
      const formulas = new Map([
        ['A', 'B + 100'],
        ['B', 'A * 0.5'],
        ['C', 'base * 0.1'],
      ])
      const errors = detectCircularDependencies(formulas)
      expect(errors).toContain('Circular dependency detected: A → B → A')
    })

    test('longer circular dependency chain', () => {
      const formulas = new Map([
        ['A', 'B + C'],
        ['B', 'D * 0.5'],
        ['C', 'base * 0.1'],
        ['D', 'A - 100'],
      ])
      const errors = detectCircularDependencies(formulas)
      expect(errors).toContain('Circular dependency detected: A → B → D → A')
    })

    test('multiple independent cycles', () => {
      const formulas = new Map([
        ['A', 'B + 100'],
        ['B', 'A * 0.5'],
        ['C', 'D + 50'],
        ['D', 'C - 20'],
        ['E', 'base * 0.1'],
      ])
      const errors = detectCircularDependencies(formulas)
      expect(errors).toContain('Circular dependency detected: A → B → A')
      expect(errors).toContain('Circular dependency detected: C → D → C')
    })

    test('self-referential formula', () => {
      const formulas = new Map([
        ['A', 'A + 100'], // A depends on itself
        ['B', 'base * 0.1'],
      ])
      const errors = detectCircularDependencies(formulas)
      expect(errors).toContain('Circular dependency detected: A → A')
    })

    test('ignores dependencies on non-component variables', () => {
      const formulas = new Map([
        ['HRA', 'base * 0.4'],
        ['DA', 'gross * 0.2'], // gross is reserved, not a component
        ['TAX', 'net * 0.1'], // net is reserved
      ])
      const errors = detectCircularDependencies(formulas)
      expect(errors).toEqual([])
    })
  })
})