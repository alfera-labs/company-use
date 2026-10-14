import { SegmentedControl, SegmentedControlItem } from '@coworker/ui/components/segmented-control';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

const theme_options = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const;

export function ThemeSettings() {
  const { theme, setTheme } = useTheme();
  const [mounted, set_mounted] = useState(false);

  useEffect(() => {
    set_mounted(true);
  }, []);

  const active = mounted ? (theme ?? 'system') : 'system';

  return (
    <SegmentedControl aria-label="Theme" value={active} onValueChange={setTheme}>
      {theme_options.map((option) => {
        const Icon = option.icon;
        return (
          <SegmentedControlItem key={option.value} value={option.value}>
            <Icon />
            {option.label}
          </SegmentedControlItem>
        );
      })}
    </SegmentedControl>
  );
}
