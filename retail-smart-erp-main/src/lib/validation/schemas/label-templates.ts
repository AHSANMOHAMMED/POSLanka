import { z } from 'zod'

const barcodeFormatSchema = z.enum([
  'code128', 'ean13', 'ean8', 'upca', 'code39',
  'qrcode', 'datamatrix', 'pdf417', 'itf14', 'code93', 'codabar',
])

const dynamicFieldSchema = z.enum([
  'item.name', 'item.sku', 'item.barcode', 'item.sellingPrice',
  'item.costPrice', 'item.priceCode', 'item.discountCode',
  'item.brand', 'item.oemPartNumber', 'item.pluCode',
  'item.category', 'item.unit', 'item.weight', 'item.dimensions',
  'tenant.name', 'custom',
])

const baseElementSchema = z.object({
  id: z.string().min(1),
  x: z.number().min(0).max(300),
  y: z.number().min(0).max(300),
  width: z.number().min(1).max(300),
  height: z.number().min(1).max(300),
  rotation: z.number().min(-360).max(360),
  zIndex: z.number().min(0).max(200),
})

const barcodeElementSchema = baseElementSchema.extend({
  type: z.literal('barcode'),
  format: barcodeFormatSchema,
  dataField: dynamicFieldSchema,
  showText: z.boolean(),
  barWidth: z.number().min(1).max(4),
  customValue: z.string().max(200).optional(),
})

const textElementSchema = baseElementSchema.extend({
  type: z.literal('text'),
  dataField: dynamicFieldSchema,
  customValue: z.string().max(500).optional(),
  fontSize: z.number().min(4).max(72),
  fontWeight: z.enum(['normal', 'bold']),
  textAlign: z.enum(['left', 'center', 'right']),
  prefix: z.string().max(50).optional(),
  suffix: z.string().max(50).optional(),
  maxLines: z.number().min(1).max(10),
  isCurrency: z.boolean().optional(),
  autoFit: z.boolean().optional(),
})

const imageElementSchema = baseElementSchema.extend({
  type: z.literal('image'),
  source: z.enum(['logo', 'item-image', 'custom']),
  customUrl: z.string().url().max(500).optional(),
})

const shapeElementSchema = baseElementSchema.extend({
  type: z.literal('shape'),
  shape: z.enum(['line', 'rectangle', 'rounded-rectangle', 'ellipse']),
  borderWidth: z.number().min(0).max(10),
  borderColor: z.string().max(20),
  borderStyle: z.enum(['solid', 'dashed', 'dotted']),
  fillColor: z.string().max(20).optional(),
  cornerRadius: z.number().min(0).max(50).optional(),
})

const labelElementSchema = z.discriminatedUnion('type', [
  barcodeElementSchema,
  textElementSchema,
  imageElementSchema,
  shapeElementSchema,
])

const labelShapeSchema = z.enum(['rectangle', 'rounded-rectangle', 'circle', 'oval'])

export const createLabelTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  widthMm: z.number().min(10).max(300),
  heightMm: z.number().min(10).max(300),
  labelShape: labelShapeSchema.optional(),
  cornerRadius: z.number().min(0).max(50).optional(),
  elements: z.array(labelElementSchema).max(50),
  isDefault: z.boolean().optional(),
})

export const updateLabelTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  widthMm: z.number().min(10).max(300).optional(),
  heightMm: z.number().min(10).max(300).optional(),
  labelShape: labelShapeSchema.optional(),
  cornerRadius: z.number().min(0).max(50).nullable().optional(),
  elements: z.array(labelElementSchema).max(50).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export const labelTemplatesListSchema = z.object({
  all: z.string().optional(),
})

export const updateLabelSettingsSchema = z.object({
  codeWord: z.string().max(10).optional(),
})
