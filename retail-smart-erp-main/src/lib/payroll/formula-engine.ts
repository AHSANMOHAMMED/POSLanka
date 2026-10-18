/**
 * Safe expression evaluator for salary component formulas.
 * Uses recursive descent parsing - NO eval().
 *
 * Supported:
 * - Arithmetic: +, -, *, /, (, )
 * - Numbers: 0.08, 1000, etc.
 * - Variables: base, gross, net, amount, {ABBREVIATION}
 *
 * Examples:
 *   "base * 0.08"
 *   "gross * 0.03"
 *   "BP * 0.10"
 *   "amount"
 *   "(base + gross) * 0.05"
 *   "base * 0.08 + 500"
 */

export interface FormulaContext {
  base: number       // baseSalary
  gross: number      // sum of earnings so far
  net: number        // gross - deductions so far
  amount: number     // defaultAmount of current component
  [abbreviation: string]: number // other component amounts by abbreviation
}

class FormulaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormulaError'
  }
}

// Reserved variable names that cannot be used as component abbreviations
const RESERVED_VARIABLES = new Set(['base', 'gross', 'net', 'amount', 'true', 'false', 'null', 'undefined', 'NaN', 'Infinity'])

// Epsilon for near-zero division protection in financial calculations
// 0.01 = 1 cent - we shouldn't divide by amounts less than this
const DIVISION_EPSILON = 0.01

// Tokenizer
type TokenType = 'NUMBER' | 'IDENT' | 'PLUS' | 'MINUS' | 'STAR' | 'SLASH' | 'LPAREN' | 'RPAREN' | 'EOF'

interface Token {
  type: TokenType
  value: string
}

/**
 * Validate that a component abbreviation is safe to use in formulas.
 * Returns null if valid, or an error message string.
 */
export function validateComponentAbbreviation(abbreviation: string): string | null {
  if (!abbreviation || abbreviation.trim() === '') {
    return 'Abbreviation cannot be empty'
  }
  
  // Check length
  if (abbreviation.length > 20) {
    return 'Abbreviation must be 20 characters or less'
  }
  
  // Check format (must start with letter, only alphanumeric and underscore)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(abbreviation)) {
    return 'Abbreviation must start with a letter or underscore and contain only letters, numbers, and underscores'
  }
  
  // Check for reserved variable names
  if (RESERVED_VARIABLES.has(abbreviation.toLowerCase())) {
    return `Abbreviation "${abbreviation}" is a reserved variable name and cannot be used`
  }
  
  return null
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const src = expression.trim()
  let bracketBalance = 0

  while (i < src.length) {
    const ch = src[i]

    // Whitespace
    if (/\s/.test(ch)) {
      i++
      continue
    }

    // Number (integer or decimal)
    if (/[0-9.]/.test(ch)) {
      let num = ''
      let hasDot = false
      while (i < src.length && /[0-9.]/.test(src[i])) {
        if (src[i] === '.') {
          if (hasDot) throw new FormulaError(`Invalid number at position ${i}`)
          hasDot = true
        }
        num += src[i]
        i++
      }
      tokens.push({ type: 'NUMBER', value: num })
      continue
    }

    // Identifier (variable name)
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = ''
      while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) {
        ident += src[i]
        i++
      }
      tokens.push({ type: 'IDENT', value: ident })
      continue
    }

    // Operators
    switch (ch) {
      case '+': tokens.push({ type: 'PLUS', value: '+' }); i++; break
      case '-': tokens.push({ type: 'MINUS', value: '-' }); i++; break
      case '*': tokens.push({ type: 'STAR', value: '*' }); i++; break
      case '/': tokens.push({ type: 'SLASH', value: '/' }); i++; break
      case '(': 
        tokens.push({ type: 'LPAREN', value: '(' })
        bracketBalance++
        i++
        break
      case ')':
        tokens.push({ type: 'RPAREN', value: ')' })
        bracketBalance--
        if (bracketBalance < 0) {
          throw new FormulaError(`Mismatched closing parenthesis at position ${i}`)
        }
        i++
        break
      default:
        throw new FormulaError(`Unexpected character '${ch}' at position ${i}`)
    }
  }

  // Final bracket balance check
  if (bracketBalance > 0) {
    throw new FormulaError(`Unclosed parenthesis: ${bracketBalance} missing closing bracket(s)`)
  }

  tokens.push({ type: 'EOF', value: '' })
  return tokens
}

// Recursive descent parser
class Parser {
  private tokens: Token[]
  private pos: number
  private context: FormulaContext

  constructor(tokens: Token[], context: FormulaContext) {
    this.tokens = tokens
    this.pos = 0
    this.context = context
  }

  private current(): Token {
    return this.tokens[this.pos]
  }

  private eat(type: TokenType): Token {
    const token = this.current()
    if (token.type !== type) {
      throw new FormulaError(`Expected ${type} but got ${token.type} ('${token.value}')`)
    }
    this.pos++
    return token
  }

  // expression = term (('+' | '-') term)*
  parse(): number {
    const result = this.expression()
    if (this.current().type !== 'EOF') {
      throw new FormulaError(`Unexpected token '${this.current().value}' after expression`)
    }
    return result
  }

  private expression(): number {
    let result = this.term()

    while (this.current().type === 'PLUS' || this.current().type === 'MINUS') {
      const op = this.current().type
      this.pos++
      const right = this.term()
      if (op === 'PLUS') {
        result += right
      } else {
        result -= right
      }
    }

    return result
  }

  // term = unary (('*' | '/') unary)*
  private term(): number {
    let result = this.unary()

    while (this.current().type === 'STAR' || this.current().type === 'SLASH') {
      const op = this.current().type
      this.pos++
      const right = this.unary()
      if (op === 'STAR') {
        result *= right
      } else {
        if (Math.abs(right) < DIVISION_EPSILON) throw new FormulaError('Division by zero (or near-zero)')
        result /= right
      }
    }

    return result
  }

  // unary = ('-')? factor
  private unary(): number {
    if (this.current().type === 'MINUS') {
      this.pos++
      return -this.factor()
    }
    return this.factor()
  }

  // factor = NUMBER | IDENT | '(' expression ')'
  private factor(): number {
    const token = this.current()

    if (token.type === 'NUMBER') {
      this.pos++
      return parseFloat(token.value)
    }

    if (token.type === 'IDENT') {
      this.pos++
      const varName = token.value
      if (varName in this.context) {
        return this.context[varName]
      }
      throw new FormulaError(`Unknown variable '${varName}'`)
    }

    if (token.type === 'LPAREN') {
      this.eat('LPAREN')
      const result = this.expression()
      this.eat('RPAREN')
      return result
    }

    throw new FormulaError(`Unexpected token '${token.value}'`)
  }
}

/**
 * Evaluate a salary formula expression with the given context.
 * Returns the computed amount, rounded to 2 decimal places.
 */
export function evaluateFormula(expression: string, context: FormulaContext): number {
  if (!expression || expression.trim() === '') {
    return context.amount || 0
  }

  const tokens = tokenize(expression)
  const parser = new Parser(tokens, context)
  const result = parser.parse()

  // Guard against NaN/Infinity
  if (!isFinite(result)) {
    throw new FormulaError(`Formula result is not a finite number: ${result}`)
  }

  // Round to 2 decimal places
  return Math.round(result * 100) / 100
}

/**
 * Validate a formula expression without evaluating it.
 * Returns null if valid, or an error message string.
 */
export function validateFormula(expression: string): string | null {
  if (!expression || expression.trim() === '') {
    return null // Empty formula is valid (uses defaultAmount)
  }

  try {
    // Test with dummy context containing all standard variables
    const dummyContext: FormulaContext = {
      base: 1000,
      gross: 1000,
      net: 1000,
      amount: 0,
    }
    const tokens = tokenize(expression)
    // Just check tokenization succeeds; we can't fully validate variable names
    // without knowing all abbreviations, but we check syntax
    new Parser(tokens, dummyContext)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid formula'
  }
}

/**
 * Preview a formula result with example values.
 * Returns the computed amount or an error message.
 */
export function previewFormula(
  expression: string,
  baseSalary: number = 50000,
  additionalVars?: Record<string, number>
): { result: number | null; error: string | null } {
  try {
    const context: FormulaContext = {
      base: baseSalary,
      gross: baseSalary,
      net: baseSalary,
      amount: 0,
      ...additionalVars,
    }
    const result = evaluateFormula(expression, context)
    return { result, error: null }
  } catch (error) {
    return { result: null, error: error instanceof Error ? error.message : 'Invalid formula' }
  }
}

/**
 * Extract variable dependencies from a formula expression.
 * Returns a Set of variable names (excluding reserved variables) that the formula depends on.
 */
export function extractFormulaDependencies(expression: string): Set<string> {
  if (!expression || expression.trim() === '') {
    return new Set()
  }

  const dependencies = new Set<string>()
  try {
    const tokens = tokenize(expression)
    for (const token of tokens) {
      if (token.type === 'IDENT' && !RESERVED_VARIABLES.has(token.value.toLowerCase())) {
        dependencies.add(token.value)
      }
    }
  } catch {
    // If tokenization fails, return empty set (validation will catch this elsewhere)
  }
  return dependencies
}

/**
 * Detect circular dependencies in a collection of salary component formulas.
 * 
 * @param formulas Map of component abbreviation to formula expression (null/empty for default amount)
 * @returns Array of error messages for detected cycles, empty if no cycles
 */
export function detectCircularDependencies(
  formulas: Map<string, string | null>
): string[] {
  // Build dependency graph
  const graph = new Map<string, Set<string>>()
  const nodes = new Set<string>()

  // Initialize graph nodes
  for (const [abbr] of formulas) {
    nodes.add(abbr)
    graph.set(abbr, new Set())
  }

  // Add edges based on formula dependencies
  for (const [abbr, formula] of formulas) {
    if (!formula) continue
    const deps = extractFormulaDependencies(formula)
    for (const dep of deps) {
      if (nodes.has(dep)) {
        graph.get(abbr)!.add(dep)
      }
      // Note: dependencies on non-component variables (base, gross, net, amount) are ignored
    }
  }

  // Detect cycles using DFS
  const errors: string[] = []
  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  function dfs(node: string, path: string[]): boolean {
    if (recursionStack.has(node)) {
      // Found a cycle
      const cycleStart = path.indexOf(node)
      const cycle = [...path.slice(cycleStart), node]
      errors.push(`Circular dependency detected: ${cycle.join(' → ')}`)
      return true
    }

    if (visited.has(node)) {
      return false
    }

    visited.add(node)
    recursionStack.add(node)
    path.push(node)

    for (const neighbor of graph.get(node) || []) {
      if (dfs(neighbor, path)) {
        return true
      }
    }

    recursionStack.delete(node)
    path.pop()
    return false
  }

  for (const node of nodes) {
    if (!visited.has(node)) {
      dfs(node, [])
    }
  }

  return errors
}
