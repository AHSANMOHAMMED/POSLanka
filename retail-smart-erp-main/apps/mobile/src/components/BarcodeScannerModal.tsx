import React, { useState } from 'react'
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { THEME } from '../lib/theme'

interface BarcodeScannerModalProps {
  visible: boolean
  onClose: () => void
  onBarcodeScanned: (barcode: string) => void
}

export function BarcodeScannerModal({
  visible,
  onClose,
  onBarcodeScanned,
}: BarcodeScannerModalProps) {
  const [permission, requestPermission] = useCameraPermissions()
  const [scanned, setScanned] = useState(false)

  if (!visible) return null

  function handleBarcode({ data }: { data: string }) {
    if (scanned) return
    setScanned(true)
    onBarcodeScanned(data)
    setTimeout(() => {
      setScanned(false)
      onClose()
    }, 500)
  }

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <Text style={styles.title}>Scan Barcode / QR</Text>
          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeText}>✕ Close</Text>
          </Pressable>
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
              onBarcodeScanned={scanned ? undefined : handleBarcode}
              barcodeScannerSettings={{
                barcodeTypes: [
                  'ean13',
                  'ean8',
                  'upc_a',
                  'upc_e',
                  'code128',
                  'code39',
                  'qr',
                ],
              }}
            />
            {/* Viewfinder Target Reticle */}
            <View style={styles.overlay}>
              <View style={styles.reticle}>
                <View style={[styles.corner, styles.topLeft]} />
                <View style={[styles.corner, styles.topRight]} />
                <View style={[styles.corner, styles.bottomLeft]} />
                <View style={[styles.corner, styles.bottomRight]} />
                {scanned && <View style={styles.scannedHighlight} />}
              </View>
              <Text style={styles.hint}>
                {scanned ? 'Barcode Detected!' : 'Center barcode inside the frame'}
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
    height: 70,
    paddingTop: 30,
    paddingHorizontal: 20,
    backgroundColor: '#1E293B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  title: { color: '#FFF', fontSize: 18, fontWeight: '700' },
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
})
