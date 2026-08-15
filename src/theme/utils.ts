/**
 * Theme helper utilities (mirrors mattermost-mobile app/utils/theme).
 */
import {theme, type ThemeColors} from './index';

const rgbPattern = /^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/;

export function getComponents(inColor: string): {
  red: number;
  green: number;
  blue: number;
  alpha: number;
} {
  let color = inColor;
  const match = rgbPattern.exec(color);
  if (match) {
    return {
      red: parseInt(match[1], 10),
      green: parseInt(match[2], 10),
      blue: parseInt(match[3], 10),
      alpha: match[4] ? parseFloat(match[4]) : 1,
    };
  }
  if (color[0] === '#') {
    color = color.slice(1);
  }
  if (color.length === 3) {
    const t = color;
    color = '';
    color += t[0] + t[0];
    color += t[1] + t[1];
    color += t[2] + t[2];
  }
  return {
    red: parseInt(color.substring(0, 2), 16),
    green: parseInt(color.substring(2, 4), 16),
    blue: parseInt(color.substring(4, 6), 16),
    alpha: 1,
  };
}

/** Apply an opacity multiplier to any CSS color. */
export function changeOpacity(oldColor: string, opacity: number): string {
  const {red, green, blue, alpha} = getComponents(oldColor);
  return `rgba(${red},${green},${blue},${alpha * opacity})`;
}

/** True when the background is light (used to pick status-bar style etc). */
export function isLightColor(color: string): boolean {
  const {red, green, blue} = getComponents(color);
  // Perceived luminance
  return (0.299 * red + 0.587 * green + 0.114 * blue) > 128;
}

export {theme};
export type {ThemeColors};
