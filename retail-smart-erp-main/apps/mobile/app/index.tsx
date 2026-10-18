import { Redirect } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { getToken } from '../src/lib/api'

export default function Index() {
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    getToken().then((t) => {
      setAuthed(Boolean(t))
      setReady(true)
    })
  }, [])

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    )
  }

  return <Redirect href={authed ? '/pos' : '/login'} />
}
