import { Tabs } from 'expo-router';
import { Text, useColorScheme, type ColorValue } from 'react-native';

import { Colors } from '@/constants/theme';

function TabGlyph({ glyph, active, color }: { glyph: string; active: boolean; color: ColorValue }) {
  return <Text style={{ color: active ? color : color, fontSize: 23, lineHeight: 23, textAlign: 'center' }}>{glyph}</Text>;
}

export default function AppTabs() {
  const colors = Colors[useColorScheme() === 'light' ? 'light' : 'dark'];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.backgroundElement, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIconStyle: { marginBottom: -4 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, focused }) => <TabGlyph glyph="⌂" active={focused} color={color} /> }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: ({ color, focused }) => <TabGlyph glyph="⌕" active={focused} color={color} /> }} />
      <Tabs.Screen name="create-post" options={{ title: 'Post', tabBarIcon: ({ color, focused }) => <TabGlyph glyph="＋" active={focused} color={color} /> }} />
      <Tabs.Screen name="chats" options={{ title: 'Chats', tabBarIcon: ({ color, focused }) => <TabGlyph glyph="✉" active={focused} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, focused }) => <TabGlyph glyph="◉" active={focused} color={color} /> }} />
    </Tabs>
  );
}
