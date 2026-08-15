/**
 * Channel List Screen — full-featured
 *
 * Features:
 * - Channel categories (Channels, Direct Messages)
 * - Unread message badges
 * - Mention count badges
 * - DM channel display with other user's name
 * - Channel search/filter
 * - Real-time channel creation/update via WebSocket
 * - Team switcher
 * - New Direct Message button
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {type MattermostClient} from '../api/client';
import type {Channel, Team, UserProfile} from '../api/types';
import {WebSocketEvents} from '../api/types';
import {Avatar} from '../components';
import CreateChannelModal from '../components/CreateChannelModal';
import {cache, type DisplayChannelData} from '../api/cache';
import {getActiveChannelId} from '../api/notifications';
import {theme, changeOpacity} from '../theme/utils';

interface Props {
  client: MattermostClient;
  onChannelSelect: (channel: Channel) => void;
  onLogout: () => void;
  onSearch?: () => void;
  onThreads?: () => void;
  // When false, hide the built-in header (identity + ＋ + logout). Used by the
  // wide-screen layout where these actions live in the full-width TopBar.
  showHeader?: boolean;
}

interface DisplayChannel {
  channel: Channel;
  unreadCount: number;
  mentionCount: number;
  displayName: string;
  otherUser?: UserProfile;
}

export default function ChannelListScreen({
  client,
  onChannelSelect,
  onLogout,
  onSearch,
  onThreads,
  showHeader = true,
}: Props) {
  const imageHeaders = useMemo(() => client.getImageRequestHeaders(), [client]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [displayChannels, setDisplayChannels] = useState<DisplayChannel[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showDMModal, setShowDMModal] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile>>({});
  // Collapsible sidebar categories: 'channels' | 'dms' (default expanded).
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const loadData = useCallback(async (forceRefresh = false) => {
    try {
      const cachedTeams = cache.getTeams();
      const teamId = selectedTeamId || cachedTeams?.[0]?.id || '';

      // Step 1: Render cached display channels INSTANTLY (zero API calls)
      if (teamId) {
        const cachedDisplay = cache.getDisplayChannels(teamId);
        if (cachedDisplay) {
          // Convert cached data back to DisplayChannel (resolve otherUser profile from cache)
          const cachedList: DisplayChannel[] = cachedDisplay.map((dc) => ({
            channel: dc.channel,
            unreadCount: dc.unreadCount,
            mentionCount: dc.mentionCount,
            displayName: dc.displayName,
            otherUser: dc.otherUserId ? cache.getUser(dc.otherUserId) || undefined : undefined,
          }));
          setDisplayChannels(cachedList);
          if (cachedTeams) setTeams(cachedTeams);
          // Cache hit — do NOT show loading spinner
          setLoading(false);
        }
      }

      // Step 2: Refresh from API only if stale or forced; cache shows instantly.
      const age = cache.getDisplayChannelsAge(teamId);
      const stale = age < 0 || age > 30 * 60 * 1000;
      const needsFetch = forceRefresh || !cachedTeams || stale;
      if (!needsFetch) {
        return; // Cache is fresh, nothing to do
      }

      // Background refresh — don't show a spinner since cached data is visible.
      if (forceRefresh && !cachedTeams) {
        setLoading(true);
      }
      setError(null);

      const me = currentUserId ? cache.getUser(currentUserId) : null;
      const meUser = me || await client.getMe();
      cache.setUser(meUser);
      setUserName(meUser.username);
      setCurrentUserId(meUser.id);

      let teamList = cachedTeams;
      if (!teamList) {
        teamList = await client.getTeams();
        cache.setTeams(teamList);
      }
      setTeams(teamList);

      if (teamList.length > 0) {
        const tid = selectedTeamId || teamList[0].id;
        if (!selectedTeamId) setSelectedTeamId(tid);
        client.setTeamId(tid);

        const channelList = await client.getChannelsForUser(meUser.id, tid);
        cache.setChannels(tid, channelList);

        await buildDisplayChannels(channelList, tid, meUser);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [client, selectedTeamId]);

  // Build display channels from raw channel list (called only on first load or refresh)
  const buildDisplayChannels = useCallback(async (channelList: Channel[], teamId: string, meUser: UserProfile) => {
    // Check if we already have cached display data for these channels
    const existingDisplay = cache.getDisplayChannels(teamId);
    const displayDataMap = new Map<string, DisplayChannelData>();
    if (existingDisplay) {
      for (const dc of existingDisplay) {
        displayDataMap.set(dc.channel.id, dc);
      }
    }

    const displayList: DisplayChannel[] = [];
    const cacheData: DisplayChannelData[] = [];

    for (const ch of channelList) {
      // Reuse cached display data if channel hasn't changed
      const cached = displayDataMap.get(ch.id);
      if (cached && cached.channel.update_at === ch.update_at) {
        displayList.push({
          channel: cached.channel,
          unreadCount: cached.unreadCount,
          mentionCount: cached.mentionCount,
          displayName: cached.displayName,
          otherUser: cached.otherUserId ? cache.getUser(cached.otherUserId) || undefined : undefined,
        });
        cacheData.push(cached);
        continue;
      }

      // New or changed channel — resolve
      let displayName = ch.display_name || ch.name;
      let otherUser: UserProfile | undefined;
      let otherUserId: string | undefined;

      if (ch.type === 'D') {
        try {
          const members = await client.getChannelMembers(ch.id);
          const otherMember = members.find((m) => m.user_id !== meUser.id);
          if (otherMember) {
            otherUserId = otherMember.user_id;
            const cachedUser = cache.getUser(otherMember.user_id);
            if (cachedUser) {
              otherUser = cachedUser;
              displayName = cachedUser.username;
            } else {
              otherUser = await client.getUser(otherMember.user_id);
              cache.setUser(otherUser);
              displayName = otherUser.username;
            }
          }
        } catch {}
      }

      let unreadCount = 0;
      let mentionCount = 0;
      try {
        const unread = await client.getChannelUnread(ch.id);
        unreadCount = unread.unread_count || 0;
        mentionCount = unread.mention_count || 0;
      } catch {}

      const dc: DisplayChannel = {
        channel: ch,
        unreadCount,
        mentionCount,
        displayName,
        otherUser,
      };
      displayList.push(dc);
      cacheData.push({
        channel: ch,
        unreadCount,
        mentionCount,
        displayName,
        otherUserId,
      });
    }

    // Sort: unread first, then by name
    displayList.sort((a, b) => {
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
      if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    setDisplayChannels(displayList);
    // Cache the sorted result
    const sortedCacheData = cacheData.sort((a, b) => {
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
      if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
    cache.setDisplayChannels(teamId, sortedCacheData);
  }, [client]);

  useEffect(() => {
    loadData();

    // Listen for events — use incremental updates instead of full reload
    const unsubs: Array<() => void> = [];
    unsubs.push(
      client.onWsEvent(WebSocketEvents.CHANNEL_CREATED, () => loadData(true)),
    );
    unsubs.push(
      client.onWsEvent(WebSocketEvents.CHANNEL_UPDATED, () => loadData(true)),
    );
    unsubs.push(
      client.onWsEvent(WebSocketEvents.POSTED, (msg) => {
        // Increment unread count for the channel that received a message
        const channelId = msg.broadcast?.channel_id;
        if (!channelId) return;
        const tid = client.getTeamId() || '';
        const teamId = selectedTeamId || '';
        // Don't mark the channel we're currently viewing as unread — it is
        // read in real-time (ChatScreen keeps calling viewChannel).
        if (getActiveChannelId() === channelId) {
          cache.clearUnread(tid || teamId, channelId);
          client.viewChannel(channelId).catch(() => {});
        } else {
          cache.incrementUnread(tid || teamId, channelId);
        }
        // Update display instantly from cache (no API call)
        const cached = cache.getDisplayChannels(tid || teamId);
        if (cached) {
          const updated = cached.map((dc) => ({
            channel: dc.channel,
            unreadCount: dc.unreadCount,
            mentionCount: dc.mentionCount,
            displayName: dc.displayName,
            otherUser: dc.otherUserId ? cache.getUser(dc.otherUserId) || undefined : undefined,
          }));
          setDisplayChannels(updated);
        }
      }),
    );
    unsubs.push(
      client.onWsEvent(WebSocketEvents.CHANNEL_VIEWED, (msg) => {
        const channelId = msg.data?.channel_id;
        if (!channelId) return;
        const tid = client.getTeamId() || '';
        cache.clearUnread(tid, channelId);
        // Update display instantly
        const cached = cache.getDisplayChannels(tid);
        if (cached) {
          setDisplayChannels(cached.map((dc) => ({
            channel: dc.channel,
            unreadCount: dc.channel.id === channelId ? 0 : dc.unreadCount,
            mentionCount: dc.channel.id === channelId ? 0 : dc.mentionCount,
            displayName: dc.displayName,
            otherUser: dc.otherUserId ? cache.getUser(dc.otherUserId) || undefined : undefined,
          })));
        }
      }),
    );

    return () => unsubs.forEach((u) => u());
  }, [client, loadData, selectedTeamId]);

  const handleLogout = () => {
    // Session cleanup now lives in App.handleLogout (shared by phone + wide layouts).
    onLogout();
  };

  const handleTeamSwitch = async (teamId: string) => {
    setSelectedTeamId(teamId);
    client.setTeamId(teamId);
    setLoading(true);
    try {
      const me = await client.getMe();
      const channelList = await client.getChannelsForUser(me.id, teamId);

      const displayList: DisplayChannel[] = await Promise.all(
        channelList.map(async (ch): Promise<DisplayChannel> => {
          let displayName = ch.display_name || ch.name;
          let otherUser: UserProfile | undefined;

          if (ch.type === 'D') {
            const members = await client.getChannelMembers(ch.id).catch(() => []);
            const otherMember = members.find((m) => m.user_id !== currentUserId);
            if (otherMember) {
              try {
                otherUser = await client.getUser(otherMember.user_id);
                displayName = otherUser.username;
              } catch {}
            }
          }

          let unreadCount = 0;
          let mentionCount = 0;
          try {
            const unread = await client.getChannelUnread(ch.id);
            unreadCount = unread.unread_count || 0;
            mentionCount = unread.mention_count || 0;
          } catch {}

          return {channel: ch, unreadCount, mentionCount, displayName, otherUser};
        }),
      );

      displayList.sort((a, b) => {
        if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
        if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
        return a.displayName.localeCompare(b.displayName);
      });

      setDisplayChannels(displayList);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Filtered channels ──
  const filteredChannels = useMemo(() => {
    if (!searchQuery.trim()) return displayChannels;
    const q = searchQuery.toLowerCase();
    return displayChannels.filter((dc) =>
      dc.displayName.toLowerCase().includes(q) ||
      dc.channel.name.toLowerCase().includes(q),
    );
  }, [displayChannels, searchQuery]);

  // Split into channels and DMs
  const channelsList = filteredChannels.filter(
    (dc) => dc.channel.type === 'O' || dc.channel.type === 'P',
  );
  const dmList = filteredChannels.filter(
    (dc) => dc.channel.type === 'D' || dc.channel.type === 'G',
  );

  const getChannelIcon = (type: string) => {
    switch (type) {
      case 'O': return '#';
      case 'P': return '🔒';
      case 'D': return null; // Avatar will be used
      case 'G': return '👥';
      default: return '#';
    }
  };

  const renderChannel = (dc: DisplayChannel) => {
    const icon = getChannelIcon(dc.channel.type);
    const avatarUrl = dc.otherUser
      ? client.getProfileImageUrl(dc.otherUser.id, dc.otherUser.last_picture_update)
      : undefined;

    return (
      <TouchableOpacity
        key={dc.channel.id}
        style={[styles.channelItem, dc.unreadCount > 0 && styles.channelItemUnread]}
        onPress={() => onChannelSelect(dc.channel)}>
        {dc.channel.type === 'D' ? (
          <Avatar url={avatarUrl} headers={imageHeaders} username={dc.displayName} size={36} />
        ) : (
          <View style={styles.channelIconWrap}>
            <Text style={styles.channelIcon}>{icon}</Text>
          </View>
        )}
        <View style={styles.channelInfo}>
          <View style={styles.channelNameRow}>
            <Text
              style={[
                styles.channelName,
                dc.unreadCount > 0 && styles.channelNameUnread,
              ]}
              numberOfLines={1}>
              {dc.displayName}
            </Text>
            {dc.mentionCount > 0 && (
              <View style={styles.mentionBadge}>
                <Text style={styles.mentionBadgeText}>
                  @{dc.mentionCount}
                </Text>
              </View>
            )}
          </View>
          {dc.channel.purpose ? (
            <Text style={styles.channelPurpose} numberOfLines={1}>
              {dc.channel.purpose}
            </Text>
          ) : null}
        </View>
        {dc.unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>
              {dc.unreadCount > 99 ? '99+' : dc.unreadCount}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (loading && displayChannels.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1868db" />
        <Text style={styles.loadingText}>Loading channels...</Text>
      </View>
    );
  }

  if (error && displayChannels.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => loadData(true)}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header (hidden in wide-screen layout, where actions live in the TopBar) */}
      {showHeader && (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Mattermost</Text>
            <Text style={styles.headerUser}>@{userName}</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity onPress={() => setShowCreateChannel(true)} style={styles.dmButton}>
              <Text style={styles.dmButtonText}>＋</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Search */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search channels..."
          placeholderTextColor="#6b7ca0"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Threads inbox entry */}
      {onThreads && (
        <TouchableOpacity style={styles.threadsEntry} onPress={onThreads} activeOpacity={0.7}>
          <Text style={styles.threadsEntryIcon}>💬</Text>
          <View style={styles.threadsEntryTextWrap}>
            <Text style={styles.threadsEntryTitle}>Threads</Text>
            <Text style={styles.threadsEntrySub}>Your followed discussions</Text>
          </View>
          <Text style={styles.threadsEntryArrow}>›</Text>
        </TouchableOpacity>
      )}

      {/* Team tabs */}
      {teams.length > 1 && (
        <View style={styles.teamTabs}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {teams.map((team) => (
              <TouchableOpacity
                key={team.id}
                style={[
                  styles.teamTab,
                  team.id === selectedTeamId && styles.teamTabActive,
                ]}
                onPress={() => handleTeamSwitch(team.id)}>
                <Text
                  style={[
                    styles.teamTabText,
                    team.id === selectedTeamId && styles.teamTabTextActive,
                  ]}>
                  {team.display_name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Channel list */}
      <FlatList
        data={[
          {key: 'unread', channels: filteredChannels.filter((dc) => dc.unreadCount > 0 || dc.mentionCount > 0)},
          {key: 'channels', channels: channelsList.filter((dc) => dc.unreadCount === 0 && dc.mentionCount === 0)},
          {key: 'dms', channels: dmList.filter((dc) => dc.unreadCount === 0 && dc.mentionCount === 0)},
        ]}
        keyExtractor={(item) => item.key}
        renderItem={({item}) => {
          const isCollapsed = collapsedCategories.has(item.key);
          const toggle = () => {
            setCollapsedCategories((prev) => {
              const next = new Set(prev);
              if (next.has(item.key)) next.delete(item.key);
              else next.add(item.key);
              return next;
            });
          };
          const label =
            item.key === 'unread' ? 'UNREAD' : item.key === 'channels' ? 'CHANNELS' : 'DIRECT MESSAGES';
          const count = item.channels.length;

          if (item.key === 'unread') {
            // Unread section: channels with unread/mentions, sorted by mention first.
            const unreadSorted = [...item.channels].sort((a, b) => {
              if (b.mentionCount !== a.mentionCount) return b.mentionCount - a.mentionCount;
              return b.unreadCount - a.unreadCount;
            });
            return (
              <View>
                <TouchableOpacity style={styles.sectionHeaderTouchable} onPress={toggle}>
                  <Text style={styles.sectionHeader}>UNREAD ({count})</Text>
                  <Text style={styles.sectionToggle}>{isCollapsed ? '▸' : '▾'}</Text>
                </TouchableOpacity>
                {!isCollapsed && unreadSorted.map(renderChannel)}
              </View>
            );
          }
          return (
            <View>
              <TouchableOpacity style={styles.sectionHeaderTouchable} onPress={toggle}>
                <Text style={styles.sectionHeader}>{label} ({count})</Text>
                <Text style={styles.sectionToggle}>{isCollapsed ? '▸' : '▾'}</Text>
              </TouchableOpacity>
              {!isCollapsed && (item.channels.length === 0 ? (
                <Text style={styles.emptyText}>
                  {item.key === 'channels' ? 'No channels found' : 'No direct messages'}
                </Text>
              ) : (
                item.channels.map(renderChannel)
              ))}
            </View>
          );
        }}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ListFooterComponent={<View style={{height: 40}} />}
        refreshing={loading}
        onRefresh={() => loadData(true)}      />

      {/* New DM Modal */}
      <NewDMModal
        visible={showDMModal}
        client={client}
        currentUserId={currentUserId}
        onClose={() => setShowDMModal(false)}
        onDMCreated={(channel) => {
          setShowDMModal(false);
          onChannelSelect(channel);
        }}
      />

      {/* Create Channel Modal */}
      <CreateChannelModal
        visible={showCreateChannel}
        client={client}
        teamId={selectedTeamId || client.getTeamId()}
        onClose={() => setShowCreateChannel(false)}
        onChannelCreated={(channel) => {
          setShowCreateChannel(false);
          onChannelSelect(channel);
        }}
      />
    </View>
  );
}

// ── New DM Modal ──
import {ScrollView} from 'react-native';

interface NewDMModalProps {
  visible: boolean;
  client: MattermostClient;
  currentUserId: string;
  onClose: () => void;
  onDMCreated: (channel: Channel) => void;
}

function NewDMModal({visible, client, currentUserId, onClose, onDMCreated}: NewDMModalProps) {
  const imageHeaders = useMemo(() => client.getImageRequestHeaders(), [client]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);

  const search = async (text: string) => {
    setQuery(text);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      // Search users
      const res = await client.searchUsersInTeam(text.trim());
      setResults(res.filter((u) => u.id !== currentUserId && u.delete_at === 0));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const startDM = async (user: UserProfile) => {
    try {
      const channel = await client.createDirectChannel(currentUserId, user.id);
      onDMCreated(channel);
      setQuery('');
      setResults([]);
    } catch (err: any) {
      // ignore
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.dmModalOverlay}>
        <View style={styles.dmModalContent}>
          <View style={styles.dmModalHeader}>
            <Text style={styles.dmModalTitle}>Direct Message</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.dmModalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.dmSearchInput}
            placeholder="Search users by name..."
            placeholderTextColor="#6b7ca0"
            value={query}
            onChangeText={search}
            autoFocus
            autoCapitalize="none"
          />
          {searching && <ActivityIndicator color="#1868db" style={{marginVertical: 16}} />}
          <ScrollView style={styles.dmResults}>
            {results.map((user) => {
              const avatarUrl = client.getProfileImageUrl(user.id, user.last_picture_update);
              return (
                <TouchableOpacity
                  key={user.id}
                  style={styles.dmUserItem}
                  onPress={() => startDM(user)}>
                  <Avatar url={avatarUrl} headers={imageHeaders} username={user.username} size={36} />
                  <View style={styles.dmUserInfo}>
                    <Text style={styles.dmUserName}>
                      {user.first_name || user.last_name
                        ? `${user.first_name} ${user.last_name}`.trim()
                        : user.username}
                    </Text>
                    <Text style={styles.dmUserHandle}>@{user.username}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            {!searching && query.length >= 2 && results.length === 0 && (
              <Text style={styles.emptyText}>No users found</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.sidebarBg,
  },
  centered: {
    flex: 1,
    backgroundColor: theme.sidebarBg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 12,
    backgroundColor: theme.sidebarHeaderBg,
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: theme.sidebarHeaderTextColor,
  },
  headerUser: {
    fontSize: 12,
    color: changeOpacity(theme.sidebarHeaderTextColor, 0.7),
    marginTop: 2,
  },
  dmButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  dmButtonText: {
    fontSize: 20,
  },
  logoutButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  logoutText: {
    color: changeOpacity(theme.sidebarHeaderTextColor, 0.7),
    fontSize: 14,
  },
  threadsEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: changeOpacity(theme.sidebarText, 0.08),
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
  },
  threadsEntryIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  threadsEntryTextWrap: {
    flex: 1,
  },
  threadsEntryTitle: {
    color: theme.sidebarText,
    fontSize: 15,
    fontWeight: '600',
  },
  threadsEntrySub: {
    color: changeOpacity(theme.sidebarText, 0.6),
    fontSize: 11,
    marginTop: 3,
  },
  threadsEntryArrow: {
    color: changeOpacity(theme.sidebarText, 0.6),
    fontSize: 20,
  },
  searchBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.sidebarHeaderBg,
  },
  searchInput: {
    backgroundColor: changeOpacity(theme.sidebarText, 0.1),
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: theme.sidebarText,
    borderWidth: 1,
    borderColor: changeOpacity(theme.sidebarText, 0.2),
  },
  teamTabs: {
    backgroundColor: theme.sidebarHeaderBg,
    paddingBottom: 8,
    paddingHorizontal: 12,
  },
  teamTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    marginRight: 8,
    backgroundColor: changeOpacity(theme.sidebarText, 0.1),
  },
  teamTabActive: {
    backgroundColor: theme.sidebarTextActiveBorder,
  },
  teamTabText: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 13,
    fontWeight: '500',
  },
  teamTabTextActive: {
    color: theme.sidebarTextActiveColor,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 20,
  },
  sectionHeader: {
    color: changeOpacity(theme.sidebarText, 0.5),
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  sectionHeaderTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 16,
  },
  sectionToggle: {
    color: changeOpacity(theme.sidebarText, 0.4),
    fontSize: 12,
    paddingTop: 16,
    paddingBottom: 6,
  },
  channelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  channelItemUnread: {
    backgroundColor: theme.sidebarTextHoverBg,
    borderLeftWidth: 3,
    borderLeftColor: theme.sidebarTextActiveBorder,
  },
  channelIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: changeOpacity(theme.sidebarText, 0.1),
    justifyContent: 'center',
    alignItems: 'center',
  },
  channelIcon: {
    fontSize: 16,
    color: changeOpacity(theme.sidebarText, 0.7),
    fontWeight: '600',
  },
  channelInfo: {
    flex: 1,
    marginLeft: 12,
  },
  channelNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  channelName: {
    fontSize: 15,
    color: changeOpacity(theme.sidebarText, 0.85),
    flex: 1,
  },
  channelNameUnread: {
    color: theme.sidebarUnreadText,
    fontWeight: '700',
  },
  channelPurpose: {
    fontSize: 12,
    color: changeOpacity(theme.sidebarText, 0.5),
    marginTop: 2,
  },
  unreadBadge: {
    backgroundColor: theme.mentionBg,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  unreadBadgeText: {
    color: theme.mentionColor,
    fontSize: 11,
    fontWeight: '700',
  },
  mentionBadge: {
    backgroundColor: theme.dndIndicator,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  mentionBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  loadingText: {
    color: changeOpacity(theme.sidebarText, 0.7),
    marginTop: 12,
    fontSize: 14,
  },
  errorText: {
    color: theme.errorTextColor,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: theme.buttonBg,
    borderRadius: 8,
  },
  retryText: {
    color: theme.buttonColor,
    fontSize: 14,
  },
  emptyText: {
    color: changeOpacity(theme.sidebarText, 0.5),
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  // DM Modal
  dmModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dmModalContent: {
    backgroundColor: theme.sidebarHeaderBg,
    borderRadius: 12,
    width: '90%',
    maxHeight: '70%',
    padding: 16,
  },
  dmModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  dmModalTitle: {
    color: theme.sidebarHeaderTextColor,
    fontSize: 18,
    fontWeight: '700',
  },
  dmModalClose: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 20,
  },
  dmSearchInput: {
    backgroundColor: changeOpacity(theme.sidebarText, 0.1),
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: theme.sidebarText,
    borderWidth: 1,
    borderColor: changeOpacity(theme.sidebarText, 0.2),
    marginBottom: 12,
  },
  dmResults: {
    maxHeight: 300,
  },
  dmUserItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  dmUserInfo: {
    marginLeft: 12,
  },
  dmUserName: {
    color: theme.sidebarText,
    fontSize: 15,
    fontWeight: '500',
  },
  dmUserHandle: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 12,
  },
});
