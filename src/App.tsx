/**
 * Mattermost for HarmonyOS
 * RNOH (React Native OpenHarmony) Edition
 *
 * Responsive navigation:
 *   Wide screens (tablets, width >= 700): sidebar + content two-pane layout.
 *   Narrow screens (phones): full-screen pages; the channel list slides in
 *   from the left as a drawer while viewing a chat (via the ☰ menu button).
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Animated, Easing, Modal, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {type MattermostClient} from './api/client';
import type {Channel, Post} from './api/types';
import {cache} from './api/cache';
import {persistentStorage, STORAGE_KEYS} from './api/persistent-storage';
import {theme} from './theme/utils';
import TopBar from './components/TopBar';
import LoginScreen from './screens/LoginScreen';
import ChannelListScreen from './screens/ChannelListScreen';
import ChatScreen from './screens/ChatScreen';
import SearchScreen from './screens/SearchScreen';
import ChannelInfoScreen from './screens/ChannelInfoScreen';
import ThreadsInboxScreen from './screens/ThreadsInboxScreen';
import ThreadScreen from './screens/ThreadScreen';
import SavedMessagesScreen from './screens/SavedMessagesScreen';
import ShareInModal from './components/ShareInModal';

const SIDEBAR_WIDTH = 320;
const WIDE_BREAKPOINT = 700;

type Screen =
  | {name: 'login'}
  | {name: 'channels'}
  | {name: 'chat'; channel: Channel; focusPostId?: string}
  | {name: 'thread'; channel: Channel; rootPost: Post}
  | {name: 'search'}
  | {name: 'channelInfo'; channel: Channel}
  | {name: 'saved'}
  | {name: 'threads'};

export default function App() {
  const [client, setClient] = useState<MattermostClient | null>(null);
  const [screen, setScreen] = useState<Screen>({name: 'login'});
  // When true, the chat screen was opened from the Threads Inbox, so back
  // should return to the threads page instead of the channel list.
  const [chatFromThreads, setChatFromThreads] = useState(false);
  // Content shared into the app from other apps (system share sheet) — shown
  // in a channel-picker modal to post it.
  const [sharedContent, setSharedContent] = useState<string | null>(null);
  const {width} = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;

  // Restore persistent cache once at app start (after TurboModule is ready)
  useEffect(() => {
    cache.restoreFromPersistent().then(() => {
      console.log('[App] Cache restored from persistent storage');
    });
    // Verify Push token is readable via the PushTurboModule bridge.
    import('./api/push-token').then((m) => m.logPushToken()).catch(() => {});
  }, []);

  const handleLogin = (newClient: MattermostClient) => {
    setClient(newClient);
    setScreen({name: 'channels'});
  };

  const handleLogout = async () => {
    // Clear persisted session + in-memory cache + WS connection before
    // returning to the login screen. Shared by phone and wide layouts.
    if (client) {
      await client.logout();
    }
    await persistentStorage.delete(STORAGE_KEYS.AUTH_TOKEN);
    await persistentStorage.delete(STORAGE_KEYS.USER_ID);
    await persistentStorage.delete(STORAGE_KEYS.USERNAME);
    cache.invalidateAll();
    setClient(null);
    setScreen({name: 'login'});
    setChatFromThreads(false);
  };

  const openChannel = useCallback((channel: Channel, fromThreads: boolean = false) => {
    setChatFromThreads(fromThreads);
    setScreen({name: 'chat', channel});
  }, []);

  // ── Push notification deep-link: when the user taps a push, consume the
  // pending target (channel + post) and navigate to that message. ──
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      try {
        const target = await import('./api/pushTarget').then((m) => m.consumePushTarget());
        if (cancelled) return;
        if (target) {
          try {
            const channel = await client.getChannel(target.channelId);
            if (cancelled) return;
            // If it belongs to a thread, open the thread; otherwise open the
            // channel chat and focus the message.
            if (target.rootId && target.rootId !== target.postId) {
              try {
                const post = await client.getPost(target.rootId);
                if (!cancelled) {
                  setChatFromThreads(true);
                  setScreen({name: 'thread', channel, rootPost: post});
                }
              } catch {
                if (!cancelled) {
                  setChatFromThreads(false);
                  setScreen({name: 'chat', channel, focusPostId: target.postId});
                }
              }
            } else {
              setChatFromThreads(false);
              setScreen({name: 'chat', channel, focusPostId: target.postId});
            }
          } catch {
            // channel not found — ignore
          }
        }
        // Consume content shared from other apps (system share sheet).
        const shared = await import('./api/pushTarget').then((m) => m.consumeSharedContent());
        if (!cancelled && shared) {
          console.log(`[App] Shared content received, len=${shared.length}`);
          setSharedContent(shared);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, 2000);
        }
      }
    };

    // Start polling shortly after login so the module is ready.
    timer = setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [client]);


  if (!client) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={theme.sidebarBg} />
        <LoginScreen onLogin={handleLogin} />
      </SafeAreaView>
    );
  }

  // ── Wide screen: sidebar + content two-pane layout ──
  if (isWide) {
    return (
      <>
        <MainLayout
        client={client}
        screen={screen}
        onSelectChannel={(channel: Channel) => {
          setChatFromThreads(false);
          setScreen({name: 'chat', channel});
        }}
        onOpenThreadFromInbox={(rootPostId: string, channelId: string) => {
          client.getChannel(channelId).then((ch) => {
            client.getPost(rootPostId).then((post) => {
              setScreen({name: 'thread', channel: ch, rootPost: post});
            }).catch(() => {
              setScreen({name: 'threads'});
            });
          }).catch(() => {
            setScreen({name: 'threads'});
          });
        }}
        onOpenThread={(channel: Channel, rootPost: Post) =>
          setScreen({name: 'thread', channel, rootPost})
        }
        onBack={() => setScreen({name: 'channels'})}
        onLogout={handleLogout}
        onSearch={() => setScreen({name: 'search'})}
        onThreads={() => setScreen({name: 'threads'})}
        onSaved={() => setScreen({name: 'saved'})}
        onShowInfo={(channel: Channel) => setScreen({name: 'channelInfo', channel})}
        onCloseOverlay={() => {
          if (screen.name === 'search' || screen.name === 'threads' || screen.name === 'channelInfo' || screen.name === 'thread') {
            setScreen({name: 'channels'});
          }
        }}
        />
        <ShareInModal
          client={client}
          content={sharedContent}
          onClose={() => setSharedContent(null)}
        />
      </>
    );
  }

  // ── Narrow screen: full-screen pages + drawer ──
  return (
    <>
      <PhoneNavigator
      client={client}
      screen={screen}
      chatFromThreads={chatFromThreads}
      onSelectChannel={(channel: Channel) => openChannel(channel, false)}
      onOpenThreadFromInbox={(rootPostId: string, channelId: string) => {
        client.getChannel(channelId).then((ch) => {
          client.getPost(rootPostId).then((post) => {
            setChatFromThreads(true);
            setScreen({name: 'thread', channel: ch, rootPost: post});
          }).catch(() => {
            setScreen({name: 'threads'});
          });
        }).catch(() => {
          setScreen({name: 'threads'});
        });
      }}
      onOpenThread={(channel: Channel, rootPost: Post) =>
        setScreen({name: 'thread', channel, rootPost})
      }
      onBack={() => {
        if (chatFromThreads) {
          setChatFromThreads(false);
          setScreen({name: 'threads'});
        } else {
          setScreen({name: 'channels'});
        }
      }}
      onLogout={handleLogout}
      onSearch={() => setScreen({name: 'search'})}
      onThreads={() => setScreen({name: 'threads'})}
      onSaved={() => setScreen({name: 'saved'})}
      onShowInfo={(channel: Channel) => setScreen({name: 'channelInfo', channel})}
      />
      <ShareInModal
        client={client}
        content={sharedContent}
        onClose={() => setSharedContent(null)}
      />
    </>
  );
}

/**
 * Drawer that slides the channel list in from the LEFT (narrow screens),
 * matching the WeChat phone layout. Uses an Animated translateX instead of
 * the Modal's built-in slide (which comes from the bottom).
 */
function SidebarDrawer({
  visible,
  onClose,
  onChannelSelect,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  onChannelSelect: (channel: Channel) => void;
  children: React.ReactNode;
}) {
  const translateX = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(translateX, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(translateX, {
        toValue: -SIDEBAR_WIDTH,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }).start();
    }
  }, [visible, translateX]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.drawerContainer}>
        <Animated.View
          style={[styles.drawerPanel, {transform: [{translateX}]}]}>
          {children}
        </Animated.View>
        <Pressable style={styles.drawerBackdrop} onPress={onClose} />
      </View>
    </Modal>
  );
}

/**
 * Wide-screen layout: fixed channel sidebar on the left, active page on the
 * right. Channel selection updates the right pane in place (WeChat tablet mode).
 */
function MainLayout({
  client,
  screen,
  onSelectChannel,
  onOpenThreadFromInbox,
  onOpenThread,
  onBack,
  onLogout,
  onSearch,
  onThreads,
  onShowInfo,
  onCloseOverlay,
  onSaved,
}: {
  client: MattermostClient;
  screen: Screen;
  onSelectChannel: (channel: Channel) => void;
  onOpenThreadFromInbox: (rootPostId: string, channelId: string) => void;
  onOpenThread: (channel: Channel, rootPost: Post) => void;
  onBack: () => void;
  onLogout: () => void;
  onSearch: () => void;
  onThreads: () => void;
  onShowInfo: (channel: Channel) => void;
  onCloseOverlay: () => void;
  onSaved: () => void;
}) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={theme.sidebarBg} />
      <TopBar
        client={client}
        onLogout={onLogout}
        onChannelCreated={onSelectChannel}
      />
      <View style={styles.wideLayout}>
        <View style={styles.sidebar}>
          <ChannelListScreen
            client={client}
            onChannelSelect={onSelectChannel}
            onLogout={onLogout}
            onSearch={onSearch}
            onThreads={onThreads}
            onSaved={onSaved}
            showHeader={false}
          />
        </View>
        <View style={styles.content}>
          {screen.name === 'chat' ? (
            <ChatScreen
              client={client}
              channel={screen.channel}
              onBack={onBack}
              onShowInfo={() => onShowInfo(screen.channel)}
              onOpenThread={(post) => onOpenThread(screen.channel, post)}
              focusPostId={screen.focusPostId}
              inPane
            />
          ) : screen.name === 'thread' ? (
            <ThreadScreen
              client={client}
              channel={screen.channel}
              rootPost={screen.rootPost}
              onClose={onCloseOverlay}
              inPane
            />
          ) : screen.name === 'threads' ? (
            <ThreadsInboxScreen
              client={client}
              onClose={onCloseOverlay}
              onOpenThread={onOpenThreadFromInbox}
              inPane
            />
          ) : screen.name === 'search' ? (
            <SearchScreen
              client={client}
              onClose={onCloseOverlay}
              onChannelSelect={onSelectChannel}
              inPane
            />
          ) : screen.name === 'channelInfo' ? (
            <ChannelInfoScreen
              client={client}
              channel={screen.channel}
              onClose={onCloseOverlay}
              inPane
            />
          ) : screen.name === 'saved' ? (
            <SavedMessagesScreen
              client={client}
              onBack={onCloseOverlay}
              onOpenChannel={(channel, postId) => {
                onSelectChannel(channel);
              }}
              inPane
            />
          ) : (
            // Default ('channels' with nothing selected): auto-select the
            // Threads inbox so the right pane is never blank.
            <ThreadsInboxScreen
              client={client}
              onClose={onCloseOverlay}
              onOpenThread={onOpenThreadFromInbox}
              inPane
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

/**
 * Narrow-screen navigator: each page is full-screen; the channel list becomes
 * a left slide-out drawer reachable from the chat header (☰).
 */
function PhoneNavigator({
  client,
  screen,
  chatFromThreads,
  onSelectChannel,
  onOpenThreadFromInbox,
  onOpenThread,
  onBack,
  onLogout,
  onSearch,
  onThreads,
  onShowInfo,
  onSaved,
}: {
  client: MattermostClient;
  screen: Screen;
  chatFromThreads: boolean;
  onSelectChannel: (channel: Channel) => void;
  onOpenThreadFromInbox: (rootPostId: string, channelId: string) => void;
  onOpenThread: (channel: Channel, rootPost: Post) => void;
  onBack: () => void;
  onLogout: () => void;
  onSearch: () => void;
  onThreads: () => void;
  onShowInfo: (channel: Channel) => void;
  onSaved: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const pickChannel = (channel: Channel) => {
    setDrawerOpen(false);
    onSelectChannel(channel);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={theme.sidebarBg} />

      {screen.name === 'channels' ? (
        <ChannelListScreen
          client={client}
          onChannelSelect={pickChannel}
          onLogout={onLogout}
          onSearch={onSearch}
          onThreads={onThreads}
          onSaved={onSaved}
        />
      ) : screen.name === 'chat' ? (
        <ChatScreen
          client={client}
          channel={screen.channel}
          onBack={onBack}
          onShowInfo={() => onShowInfo(screen.channel)}
          onMenu={() => setDrawerOpen(true)}
          onOpenThread={(post) => onOpenThread(screen.channel, post)}
          focusPostId={screen.focusPostId}
        />
      ) : screen.name === 'thread' ? (
        <ThreadScreen
          client={client}
          channel={screen.channel}
          rootPost={screen.rootPost}
          onClose={onBack}
          onMenu={() => setDrawerOpen(true)}
        />
      ) : screen.name === 'threads' ? (
        <ThreadsInboxScreen
          client={client}
          onClose={onBack}
          onOpenThread={onOpenThreadFromInbox}
          onMenu={() => setDrawerOpen(true)}
        />
      ) : screen.name === 'search' ? (
        <SearchScreen
          client={client}
          onClose={onBack}
          onChannelSelect={pickChannel}
          onMenu={() => setDrawerOpen(true)}
        />
      ) : screen.name === 'channelInfo' ? (
        <ChannelInfoScreen
          client={client}
          channel={screen.channel}
          onClose={onBack}
          onMenu={() => setDrawerOpen(true)}
        />
      ) : screen.name === 'saved' ? (
        <SavedMessagesScreen
          client={client}
          onBack={onBack}
          onOpenChannel={(ch, postId) => {
            setDrawerOpen(false);
            onSelectChannel(ch);
          }}
        />
      ) : null}

      {screen.name !== 'channels' && screen.name !== 'login' && (
        <SidebarDrawer
          visible={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onChannelSelect={pickChannel}>
          <ChannelListScreen
            client={client}
            onChannelSelect={pickChannel}
            onLogout={onLogout}
            onSearch={onSearch}
            onThreads={onThreads}
          />
        </SidebarDrawer>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.sidebarBg,
  },
  wideLayout: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: SIDEBAR_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: theme.sidebarHeaderBg,
    backgroundColor: theme.sidebarBg,
  },
  content: {
    flex: 1,
    backgroundColor: theme.centerChannelBg,
  },
  emptyPane: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: theme.centerChannelColor,
    fontSize: 14,
  },
  drawerContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  drawerPanel: {
    width: SIDEBAR_WIDTH,
    height: '100%',
    backgroundColor: theme.sidebarBg,
  },
});
