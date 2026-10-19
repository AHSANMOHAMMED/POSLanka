// Type declarations for Expo mobile app modules
declare module 'expo-secure-store' {
  export function getItemAsync(key: string, options?: unknown): Promise<string | null>;
  export function setItemAsync(key: string, value: string, options?: unknown): Promise<void>;
  export function deleteItemAsync(key: string, options?: unknown): Promise<void>;
}

declare module 'expo-router' {
  export const router: {
    push: (href: string) => void;
    replace: (href: string) => void;
    back: () => void;
  };
  export function useLocalSearchParams<T = Record<string, string>>(): T;
  export function Slot(props: any): any;
  export function Redirect(props: { href: string }): any;
  export const Stack: {
    (props: any): any;
    Screen: (props: any) => any;
  };
}

declare module 'expo-status-bar' {
  export function StatusBar(props: any): any;
}

declare module 'react-native-safe-area-context' {
  export function SafeAreaProvider(props: any): any;
  export function useSafeAreaInsets(): { top: number; bottom: number; left: number; right: number };
}

declare module 'react-native' {
  export const View: any;
  export const Text: any;
  export const TextInput: any;
  export const Pressable: any;
  export const StyleSheet: {
    create: <T extends Record<string, any>>(styles: T) => T;
  };
  export const Alert: {
    alert: (title: string, message?: string, buttons?: any[]) => void;
  };
  export const FlatList: any;
  export const ActivityIndicator: any;
}

