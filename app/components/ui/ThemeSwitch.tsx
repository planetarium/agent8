import { memo } from 'react';

interface ThemeSwitchProps {
  className?: string;
}

// 항상 다크 테마를 사용하므로 테마 전환 버튼을 렌더링하지 않습니다
export const ThemeSwitch = memo((_props: ThemeSwitchProps) => {
  return null;
});
