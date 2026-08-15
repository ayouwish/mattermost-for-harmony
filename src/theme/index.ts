/**
 * Mattermost theme system.
 *
 * Colors taken verbatim from mattermost/mattermost-mobile
 * app/constants/preferences.ts (official Denim / Indigo / Onyx themes).
 * Currently the app defaults to the "Indigo" theme to match the dark look
 * used throughout the client; light theme switching can be added later.
 */

export type ThemeColors = {
  type: string;
  // Sidebar
  sidebarBg: string;
  sidebarText: string;
  sidebarUnreadText: string;
  sidebarTextHoverBg: string;
  sidebarTextActiveBorder: string;
  sidebarTextActiveColor: string;
  sidebarHeaderBg: string;
  sidebarHeaderTextColor: string;
  sidebarTeamBarBg: string;
  // Status indicators
  onlineIndicator: string;
  awayIndicator: string;
  dndIndicator: string;
  // Mentions
  mentionBg: string;
  mentionColor: string;
  mentionHighlightBg: string;
  mentionHighlightLink: string;
  // Center channel
  centerChannelBg: string;
  centerChannelColor: string;
  newMessageSeparator: string;
  linkColor: string;
  buttonBg: string;
  buttonColor: string;
  errorTextColor: string;
  codeTheme: string;
};

// Official Mattermost themes (from mattermost-mobile app/constants/preferences.ts)
export const THEMES: Record<string, ThemeColors> = {
  denim: {
    type: 'Denim',
    sidebarBg: '#1e325c',
    sidebarText: '#ffffff',
    sidebarUnreadText: '#ffffff',
    sidebarTextHoverBg: '#28427b',
    sidebarTextActiveBorder: '#5d89ea',
    sidebarTextActiveColor: '#ffffff',
    sidebarHeaderBg: '#192a4d',
    sidebarHeaderTextColor: '#ffffff',
    sidebarTeamBarBg: '#162545',
    onlineIndicator: '#3db887',
    awayIndicator: '#ffbc1f',
    dndIndicator: '#d24b4e',
    mentionBg: '#ffffff',
    mentionColor: '#1e325c',
    centerChannelBg: '#ffffff',
    centerChannelColor: '#3f4350',
    newMessageSeparator: '#cc8f00',
    linkColor: '#386fe5',
    buttonBg: '#1c58d9',
    buttonColor: '#ffffff',
    errorTextColor: '#d24b4e',
    mentionHighlightBg: '#ffd470',
    mentionHighlightLink: '#1b1d22',
    codeTheme: 'github',
  },
  sapphire: {
    type: 'Sapphire',
    sidebarBg: '#1543a3',
    sidebarText: '#ffffff',
    sidebarUnreadText: '#ffffff',
    sidebarTextHoverBg: '#2a58ba',
    sidebarTextActiveBorder: '#57b5f0',
    sidebarTextActiveColor: '#ffffff',
    sidebarHeaderBg: '#123b91',
    sidebarHeaderTextColor: '#ffffff',
    sidebarTeamBarBg: '#123582',
    onlineIndicator: '#3db887',
    awayIndicator: '#ffbc1f',
    dndIndicator: '#d24b4e',
    mentionBg: '#ffffff',
    mentionColor: '#174ab5',
    centerChannelBg: '#ffffff',
    centerChannelColor: '#3f4350',
    newMessageSeparator: '#15b7b7',
    linkColor: '#1c58d9',
    buttonBg: '#1c58d9',
    buttonColor: '#ffffff',
    errorTextColor: '#d24b4e',
    mentionHighlightBg: '#7ff0f0',
    mentionHighlightLink: '#0d6e6e',
    codeTheme: 'github',
  },
  quartz: {
    type: 'Quartz',
    sidebarBg: '#f4f4f6',
    sidebarText: '#1f2228',
    sidebarUnreadText: '#1f2228',
    sidebarTextHoverBg: '#e8e8ea',
    sidebarTextActiveBorder: '#2799ff',
    sidebarTextActiveColor: '#1f2228',
    sidebarHeaderBg: '#ededf0',
    sidebarHeaderTextColor: '#1f2228',
    sidebarTeamBarBg: '#e3e3e6',
    onlineIndicator: '#3db887',
    awayIndicator: '#f5ab00',
    dndIndicator: '#d24b4e',
    mentionBg: '#2799ff',
    mentionColor: '#ffffff',
    centerChannelBg: '#ffffff',
    centerChannelColor: '#1f2228',
    newMessageSeparator: '#0a8d7d',
    linkColor: '#1c58d9',
    buttonBg: '#1c58d9',
    buttonColor: '#ffffff',
    errorTextColor: '#d24b4e',
    mentionHighlightBg: '#a7f0ec',
    mentionHighlightLink: '#135c9d',
    codeTheme: 'github',
  },
  indigo: {
    type: 'Indigo',
    sidebarBg: '#151e32',
    sidebarText: '#ffffff',
    sidebarUnreadText: '#ffffff',
    sidebarTextHoverBg: '#222c3f',
    sidebarTextActiveBorder: '#4a7ce8',
    sidebarTextActiveColor: '#ffffff',
    sidebarHeaderBg: '#182339',
    sidebarHeaderTextColor: '#ffffff',
    sidebarTeamBarBg: '#1c2740',
    onlineIndicator: '#3db887',
    awayIndicator: '#f5ab00',
    dndIndicator: '#d24b4e',
    mentionBg: '#4a7ce8',
    mentionColor: '#ffffff',
    centerChannelBg: '#111827',
    centerChannelColor: '#dddfe4',
    newMessageSeparator: '#81a3ef',
    linkColor: '#5d89ea',
    buttonBg: '#4a7ce8',
    buttonColor: '#ffffff',
    errorTextColor: '#d24b4e',
    mentionHighlightBg: '#133a91',
    mentionHighlightLink: '#a4f4f4',
    codeTheme: 'solarized-dark',
  },
  onyx: {
    type: 'Onyx',
    sidebarBg: '#202228',
    sidebarText: '#ffffff',
    sidebarUnreadText: '#ffffff',
    sidebarTextHoverBg: '#25262a',
    sidebarTextActiveBorder: '#4a7ce8',
    sidebarTextActiveColor: '#ffffff',
    sidebarHeaderBg: '#24272d',
    sidebarHeaderTextColor: '#ffffff',
    sidebarTeamBarBg: '#292c33',
    onlineIndicator: '#3db887',
    awayIndicator: '#f5ab00',
    dndIndicator: '#d24b4e',
    mentionBg: '#4b7ce7',
    mentionColor: '#ffffff',
    centerChannelBg: '#191b1f',
    centerChannelColor: '#e3e4e8',
    newMessageSeparator: '#1adbdb',
    linkColor: '#5d89ea',
    buttonBg: '#4a7ce8',
    buttonColor: '#ffffff',
    errorTextColor: '#da6c6e',
    mentionHighlightBg: '#0d6e6e',
    mentionHighlightLink: '#a4f4f4',
    codeTheme: 'monokai',
  },
};

/**
 * Active theme. Defaults to Indigo (dark), matching the current app look.
 * A theme picker can swap this at runtime.
 */
export const theme: ThemeColors = THEMES.denim;

export default theme;
