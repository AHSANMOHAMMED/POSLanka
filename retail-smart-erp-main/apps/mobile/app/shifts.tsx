import { View, Text, Pressable, StyleSheet } from 'react-native'
import { router } from 'expo-router'

export default function ShiftsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Shifts</Text>
      <Text style={styles.body}>
        Open/close shift uses the same APIs as the web POS (`/api/pos-opening-entries`).
        Wire UI to those endpoints for production builds.
      </Text>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.link}>Back to POS</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 56, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '700', color: '#0f766e', marginBottom: 12 },
  body: { color: '#475569', marginBottom: 24, lineHeight: 20 },
  link: { color: '#0f766e', fontWeight: '600' },
})
