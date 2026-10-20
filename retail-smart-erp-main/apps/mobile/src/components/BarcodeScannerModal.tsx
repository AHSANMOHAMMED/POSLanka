import React, { useEffect, useRef, useState } from 'react'
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native'
import { CameraView, useCameraPermissions, type BarcodeScanningResult, type BarcodeType } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import { THEME } from '../lib/theme'

/** Every symbology expo-camera (SDK 52) can decode. */
export const ALL_BARCODE_TYPES: BarcodeType[] = [
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code128',
  'code39',
  'code93',
  'codabar',
  'itf14',
  'qr',
  'datamatrix',
  'pdf417',
  'aztec',
]

/** Minimum gap between two accepted scans (same or different codes). */
export const RESCAN_COOLDOWN_MS = 1200

export interface ScannedCode {
  data: string
  /** expo-camera symbology id, e.g. 'ean13', 'qr'. */
  type: string
}

interface BarcodeScannerModalProps {
  visible: boolean
  onClose: () => void
  onBarcodeScanned: (barcode: string, scan: ScannedCode) => void
  /** Keep the camera open after a scan (multi-item scanning). Default: close after the first code. */
  continuous?: boolean
  title?: string
}

export function BarcodeScannerModal({
  visible,
  onClose,
  onBarcodeScanned,
  continuous = false,
  title = 'Scan Barcode / QR',
}: BarcodeScannerModalProps) {
  const [permission, requestPermission] = useCameraPermissions()
  const [torch, setTorch] = useState(false)
  const [lastScan, setLastScan] = useState<ScannedCode | null>(null)
  const [cooling, setCooling] = useState(false)
  const lastAcceptedAt = useRef(0)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset per open; stop the torch and any pending close when the modal hides.
  useEffect(() => {
    if (!visible) {
      setTorch(false)
      setLastScan(null)
      setCooling(false)
      lastAcceptedAt.current = 0
      if (closeTimer.current) {
        clearTimeout(closeTimer.current)
        closeTimer.current = null
      }
    }
  }, [visible])

  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) requestPermission()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, permission?.granted])

  if (!visible) return null

  function handleBarcode(result: BarcodeScanningResult) {
    const now = Date.now()
    if (now - lastAcceptedAt.current < RESCAN_COOLDOWN_MS) return
    const data = (result.data || '').trim()
    if (!data) return
    lastAcceptedAt.current = now

    const scan: ScannedCode = { data, type: String(result.type || '') }
    setLastScan(scan)
    setCooling(true)
    setTimeout(() => setCooling(false), RESCAN_COOLDOWN_MS)

    // Beep/haptic so the cashier knows the code was taken without looking at the screen.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined)

    onBarcodeScanned(data, scan)

    if (!continuous) {
      closeTimer.current = setTimeout(() => {
        closeTimer.current = null
        onClose()
      }, 450)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.topActions}>
            <Pressable
              style={[styles.torchBtn, torch && styles.torchBtnOn]}
              onPress={() => setTorch((t) => !t)}
              accessibilityLabel={torch ? 'Turn torch off' : 'Turn torch on'}
            >
              <Text style={styles.torchText}>{torch ? '🔦 On' : '🔦 Off'}</Text>
            </Pressable>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeText}>✕ Close</Text>
            </Pressable>
          </View>
        </View>

        {!permission ? (
          <View style={styles.centerBox}>
            <Text style={styles.prompt}>Requesting camera permission...</Text>
          </View>
        ) : !permission.granted ? (
          <View style={styles.centerBox}>
            <Text style={styles.prompt}>Camera permission is required to scan barcodes.</Text>
            <Pressable style={styles.permBtn} onPress={requestPermission}>
              <Text style={styles.permBtnText}>Grant Permission</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.cameraContainer}>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              facing="back"
              enableTorch={torch}
              onBarcodeScanned={handleBarcode}
              barcodeScannerSettings={{ barcodeTypes: ALL_BARCODE_TYPES }}
            />
            {/* Viewfinder Target Reticle */}
            <View style={styles.overlay}>
              <View style={styles.reticle}>
                <View style={[styles.corner, styles.topLeft]} />
                <View style={[styles.corner, styles.topRight]} />
                <View style={[styles.corner, styles.bottomLeft]} />
                <View style={[styles.corner, styles.bottomRight]} />
                {cooling && <View style={styles.scannedHighlight} />}
              </View>
              <Text style={styles.hint}>
                {cooling && lastScan
                  ? `${lastScan.type.toUpperCase()} · ${lastScan.data}`
                  : 'Center barcode inside the frame'}
              </Text>
              <Text style={styles.subHint}>
                EAN · UPC · Code 128/39/93 · ITF-14 · Codabar · QR · DataMatrix · PDF417 · Aztec
              </Text>
            </View>
          </View>
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  topBar: {
    height: 74,
    paddingTop: 30,
    paddingHorizontal: 16,
    backgroundColor: '#1E293B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  title: { color: '#FFF', fontSize: 16, fontWeight: '700', flexShrink: 1 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  torchBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  torchBtnOn: { backgroundColor: THEME.colors.secondaryAmber, borderColor: THEME.colors.secondaryAmber },
  torchText: { color: '#FFF', fontWeight: '700', fontSize: 12 },
  closeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
  },
  closeText: { color: '#FFF', fontWeight: '600', fontSize: 13 },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  prompt: { color: '#FFF', textAlign: 'center', fontSize: 16, marginBottom: 20 },
  permBtn: {
    backgroundColor: THEME.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  permBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  cameraContainer: { flex: 1, position: 'relative' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  reticle: {
    width: 260,
    height: 200,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannedHighlight: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(22, 163, 74, 0.3)',
    borderRadius: 16,
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: THEME.colors.primaryLight,
  },
  topLeft: { top: -1, left: -1, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
  topRight: { top: -1, right: -1, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
  bottomLeft: { bottom: -1, left: -1, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
  bottomRight: { bottom: -1, right: -1, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },
  hint: {
    color: '#FFF',
    marginTop: 24,
    fontSize: 14,
    fontWeight: '500',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  subHint: { color: 'rgba(255,255,255,0.65)', marginTop: 10, fontSize: 10, textAlign: 'center', paddingHorizontal: 24 },
})
