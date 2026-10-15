import type { ReactNode } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';

import { hardShadow, sheet, shape } from './theme.ts';

/** The existing place form's sheet, shared by the panels hosted in Screen.overlay. */
export function PopupSheet({
  children,
  footer,
  scrollEnabled = true,
  wide = false,
}: {
  children: ReactNode;
  footer?: ReactNode;
  scrollEnabled?: boolean;
  wide?: boolean;
}) {
  const { height } = useWindowDimensions();
  return (
    <View
      style={[
        styles.sheet,
        { maxHeight: Math.min(wide ? 760 : 560, height - 150), maxWidth: wide ? 600 : 400 },
      ]}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
        style={styles.scroll}
        contentContainerStyle={styles.body}
      >
        {children}
      </ScrollView>
      {footer && <View style={styles.buttons}>{footer}</View>}
    </View>
  );
}

const styles = sheet((theme) => ({
  sheet: {
    width: '100%',
    alignSelf: 'center',
    backgroundColor: theme.surface,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radius,
    ...hardShadow(theme),
  },
  scroll: { flexShrink: 1 },
  body: { gap: 9, padding: 14 },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
  },
}));
