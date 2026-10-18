export const colors = {
  bg: '#070B14',
  surface: '#0F1626',
  surfaceAlt: '#151E31',
  border: '#22304C',
  primary: '#22D3A5',
  primaryDark: '#0E9F7E',
  primarySoft: 'rgba(34,211,165,0.12)',
  accent: '#60A5FA',
  warn: '#FBBF24',
  danger: '#F87171',
  success: '#34D399',
  text: '#F1F5F9',
  textDim: '#94A3B8',
  textFaint: '#64748B',
  white: '#FFFFFF',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 };

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  glow: {
    shadowColor: '#22D3A5',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 10,
  },
};

export const statusColor = (s: string) => {
  switch (s) {
    case 'active': return colors.success;
    case 'pending': return colors.warn;
    case 'expired': return colors.danger;
    case 'suspended': return '#F472B6';
    default: return colors.textFaint;
  }
};

export const statusLabel = (s: string) => {
  switch (s) {
    case 'active': return 'مفعل';
    case 'pending': return 'بانتظار التفعيل';
    case 'expired': return 'منتهي';
    case 'suspended': return 'موقوف';
    default: return 'مجاني / غير مفعل';
  }
};

export const statusIcon = (s: string): any => {
  switch (s) {
    case 'active': return 'checkmark-circle';
    case 'pending': return 'time';
    case 'expired': return 'alert-circle';
    case 'suspended': return 'pause-circle';
    default: return 'ellipse-outline';
  }
};
