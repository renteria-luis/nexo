import { forwardRef } from 'react';
import { View } from 'react-native';
import type { LucideProps } from 'lucide-react-native';
import { Globe, Search } from './icons.ts';
import { theme } from './theme.ts';

export const ExploreIcon = forwardRef<View, LucideProps>(function ExploreIcon(
  { size = 20, color, strokeWidth },
  ref,
) {
  const side = Number(size);
  return (
    <View ref={ref} style={{ width: side + 4, height: side + 4 }}>
      <Globe size={side} color={color} strokeWidth={strokeWidth} />
      <Search
        size={side * 0.7}
        color={color}
        strokeWidth={strokeWidth}
        style={{
          position: 'absolute',
          right: -2,
          bottom: -2,
          // Opaque so the globe does not show through the lens; amber when the button is lit,
          // or the dark lens would hide its dark ink.
          backgroundColor: color === theme.accentInk ? theme.accent : theme.surfaceSolid,
          borderRadius: side,
        }}
      />
    </View>
  );
});
