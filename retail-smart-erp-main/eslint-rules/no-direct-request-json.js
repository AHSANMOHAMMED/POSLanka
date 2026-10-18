/**
 * ESLint rule: no-direct-request-json
 *
 * Prevents using `request.json()` / `req.json()` directly in API routes.
 * All request body parsing should go through `validateBody(request, schema)`
 * which applies `stripNullValues` preprocessing before Zod validation.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow direct request.json() in API routes — use validateBody() instead',
    },
    messages: {
      noDirectJson:
        'Use `validateBody(request, schema)` from `@/lib/validation/helpers` instead of `{{ name }}.json()`. ' +
        'validateBody applies stripNullValues preprocessing that prevents Zod from rejecting null and empty-string values.',
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename || context.getFilename()

    // Only apply to API route files
    const isApiRoute =
      filename.includes('src/app/api') ||
      filename.includes('src\\app\\api')
    if (!isApiRoute) return {}

    return {
      CallExpression(node) {
        // Match: *.json()  where * is request, req, or similar
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'json' &&
          node.arguments.length === 0 &&
          node.callee.object.type === 'Identifier'
        ) {
          const objName = node.callee.object.name
          // Flag request.json() and req.json() — common parameter names
          if (objName === 'request' || objName === 'req') {
            context.report({
              node,
              messageId: 'noDirectJson',
              data: { name: objName },
            })
          }
        }
      },
    }
  },
}
