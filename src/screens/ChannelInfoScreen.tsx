/**
 * Channel Info Screen — shows channel details, members, and pinned messages
 *
 * Features:
 * - Channel header, purpose, display name
 * - Member list with roles and online status
 * - Pinned messages
 * - Leave channel (for non-default channels)
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {type MattermostClient} from '../api/client';
import type {Channel, ChannelMember, Post, UserProfile, UserStatus} from '../api/types';
import {Avatar, Markdown} from '../components';
import {formatLongDate, formatFullDateTime} from '../utils/dateFormat';
import {cache} from '../api/cache';
import {theme, changeOpacity} from '../theme/utils';

interface Props {
  client: MattermostClient;
  channel: Channel;
  onClose: () => void;
  onLeaveChannel?: () => void;
  onMenu?: () => void;
  inPane?: boolean;
}

type Tab = 'about' | 'members' | 'pinned';

export default function ChannelInfoScreen({client, channel, onClose, onLeaveChannel, onMenu, inPane = false}: Props) {
  const imageHeaders = useMemo(() => client.getImageRequestHeaders(), [client]);
  const [tab, setTab] = useState<Tab>('about');
  const [members, setMembers] = useState<Array<{member: ChannelMember; user: UserProfile; status?: UserStatus}>>([]);
  const [pinnedPosts, setPinnedPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');
  // Member add modal state
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<UserProfile[]>([]);
  const [memberSearching, setMemberSearching] = useState(false);
  // Channel notification prefs
  const [notifyLevel, setNotifyLevel] = useState('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const me = await client.getMe();
      setCurrentUserId(me.id);

      // Load current user's channel notify props
      if (channel.type !== 'D') {
        try {
          const myMember = await client.getChannelMember(channel.id, me.id);
          if (myMember?.notify_props?.desktop) {
            setNotifyLevel(myMember.notify_props.desktop);
          }
        } catch {}
      }

      // Show cached info instantly, then refresh in background.
      const cachedInfo = cache.getChannelInfo(channel.id);
      if (cachedInfo) {
        const cachedMembers = cachedInfo.members;
        const memberUserIds = cachedMembers.map((m) => m.user_id);
        const profileMap: Record<string, UserProfile> = {};
        for (const id of memberUserIds) {
          const cached = cache.getUser(id);
          if (cached) profileMap[id] = cached;
        }
        const enriched = cachedMembers
          .map((member) => ({member, user: profileMap[member.user_id], status: undefined}))
          .filter((m) => m.user)
          .sort((a, b) => {
            if (a.user.id === me.id) return -1;
            if (b.user.id === me.id) return 1;
            return a.user.username.localeCompare(b.user.username);
          });
        setMembers(enriched);
        if (cachedInfo.pinned.length > 0) {
          setPinnedPosts(cachedInfo.pinned);
        }
        setLoading(false);
      }

      // Load members and their profiles in parallel
      const [memberList] = await Promise.all([
        client.getChannelMembers(channel.id),
      ]);

      const memberUserIds = memberList.map((m) => m.user_id);
      // Use cache for profiles, fetch only missing ones
      const missingIds = cache.getMissingUserIds(memberUserIds);
      const fetchedProfiles = missingIds.length > 0
        ? await client.getProfilesByIds(missingIds).catch(() => [])
        : [];
      // Cache fetched profiles
      for (const p of fetchedProfiles) cache.setUser(p);

      const statuses = memberUserIds.length > 0
        ? await client.getStatusesByIds(memberUserIds).catch(() => [])
        : [];

      const profileMap: Record<string, UserProfile> = {};
      for (const id of memberUserIds) {
        const cached = cache.getUser(id);
        if (cached) profileMap[id] = cached;
      }
      const statusMap: Record<string, UserStatus> = {};
      for (const s of statuses) statusMap[s.user_id] = s;

      const enrichedMembers = memberList
        .map((member) => ({
          member,
          user: profileMap[member.user_id],
          status: statusMap[member.user_id],
        }))
        .filter((m) => m.user)
        .sort((a, b) => {
          // Current user first, then alphabetically
          if (a.user.id === me.id) return -1;
          if (b.user.id === me.id) return 1;
          return a.user.username.localeCompare(b.user.username);
        });

      setMembers(enrichedMembers);

      // Load pinned messages
      let pinned: Post[] = [];
      try {
        const postList = await client.getPostsForChannel(channel.id);
        pinned = Object.values(postList.posts)
          .filter((p: Post) => p.is_pinned && p.delete_at === 0)
          .sort((a: Post, b: Post) => b.create_at - a.create_at);
        setPinnedPosts(pinned);
      } catch {
        setPinnedPosts([]);
      }

      // Cache the resolved info for next visit.
      cache.setChannelInfo(channel.id, memberList, pinned);
    } catch (err) {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [client, channel.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleLeave = () => {
    if (!onLeaveChannel) return;
    onClose();
    onLeaveChannel();
  };

  // ── Member management ──
  const searchMembers = async (text: string) => {
    setMemberQuery(text);
    if (text.trim().length < 2) {
      setMemberResults([]);
      return;
    }
    setMemberSearching(true);
    try {
      const list = await client.searchUsersInTeam(text.trim());
      const memberIds = new Set(members.map((m) => m.user.id));
      setMemberResults(list.filter((u) => !memberIds.has(u.id) && u.delete_at === 0));
    } catch {
      setMemberResults([]);
    } finally {
      setMemberSearching(false);
    }
  };

  const addMember = async (user: UserProfile) => {
    try {
      await client.addChannelMember(channel.id, user.id);
      setShowAddMember(false);
      setMemberQuery('');
      setMemberResults([]);
      loadData();
    } catch {}
  };

  const updateNotify = async (level: string) => {
    setNotifyLevel(level);
    try {
      await client.updateChannelNotifyProps(channel.id, {desktop: level});
    } catch {
      // revert on failure
      setNotifyLevel((prev) => prev);
    }
  };

  const statusColor = (status?: string) => {
    switch (status) {
      case 'online': return '#50fa7b';
      case 'away': return '#f1fa8c';
      case 'dnd': return '#ff5555';
      default: return changeOpacity(theme.sidebarText, 0.5);
    }
  };

  const isDefaultChannel = channel.name === 'town-square' || channel.name === 'off-topic';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, inPane && styles.headerPane]}>
        {onMenu && (
          <TouchableOpacity onPress={onMenu} style={styles.closeButton}>
            <Text style={styles.closeText}>☰</Text>
          </TouchableOpacity>
        )}
        {!onMenu && (
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>Channel Info</Text>
        <View style={{width: 32}} />
      </View>

      {/* Channel name + type */}
      <View style={styles.channelHeader}>
        <View style={styles.channelIconLarge}>
          <Text style={styles.channelIconText}>
            {channel.type === 'D' ? '💬' : channel.type === 'P' ? '🔒' : channel.type === 'G' ? '👥' : '#'}
          </Text>
        </View>
        <Text style={styles.channelDisplayName}>
          {channel.display_name || channel.name}
        </Text>
        <Text style={styles.channelType}>
          {channel.type === 'D' ? 'Direct Message' :
           channel.type === 'P' ? 'Private Channel' :
           channel.type === 'G' ? 'Group Message' :
           'Public Channel'}
          {' • '}{members.length} member{members.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'about' && styles.tabActive]}
          onPress={() => setTab('about')}>
          <Text style={[styles.tabText, tab === 'about' && styles.tabTextActive]}>About</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'members' && styles.tabActive]}
          onPress={() => setTab('members')}>
          <Text style={[styles.tabText, tab === 'members' && styles.tabTextActive]}>
            Members ({members.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'pinned' && styles.tabActive]}
          onPress={() => setTab('pinned')}>
          <Text style={[styles.tabText, tab === 'pinned' && styles.tabTextActive]}>
            Pinned ({pinnedPosts.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="theme.buttonBg" />
        </View>
      ) : (
        <ScrollView style={styles.content} contentContainerStyle={{paddingBottom: 40}}>
          {tab === 'about' && (
            <View>
              {/* Header text */}
              {channel.header ? (
                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>CHANNEL HEADER</Text>
                  <View style={styles.infoContent}>
                    <Markdown text={channel.header} />
                  </View>
                </View>
              ) : null}

              {/* Purpose */}
              {channel.purpose ? (
                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>PURPOSE</Text>
                  <Text style={styles.infoText}>{channel.purpose}</Text>
                </View>
              ) : null}

              {/* Created date */}
              <View style={styles.infoSection}>
                <Text style={styles.infoLabel}>CREATED</Text>
                <Text style={styles.infoText}>
                  {formatLongDate(channel.create_at)}
                </Text>
              </View>

              {/* Creator */}
              {channel.creator_id ? (
                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>CREATED BY</Text>
                  <Text style={styles.infoText}>
                    {members.find((m) => m.user.id === channel.creator_id)?.user.username || 'Unknown'}
                  </Text>
                </View>
              ) : null}

              {/* Notification preferences */}
              {channel.type !== 'D' && (
                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>NOTIFICATIONS</Text>
                  <Text style={styles.infoText}>Desktop notifications for this channel</Text>
                  {(['all', 'mention', 'none'] as const).map((level) => {
                    const label = level === 'all' ? 'All messages' : level === 'mention' ? 'Only mentions' : 'Off';
                    return (
                      <TouchableOpacity
                        key={level}
                        style={[styles.notifyOption, notifyLevel === level && styles.notifyOptionActive]}
                        onPress={() => updateNotify(level)}>
                        <Text style={[styles.notifyOptionText, notifyLevel === level && styles.notifyOptionTextActive]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Leave channel */}
              {!isDefaultChannel && channel.type !== 'D' && (
                <TouchableOpacity style={styles.leaveButton} onPress={handleLeave}>
                  <Text style={styles.leaveText}>Leave Channel</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {tab === 'members' && (
            <View>
              {members.map(({user, status}) => {
                const avatarUrl = client.getProfileImageUrl(user.id, user.last_picture_update);
                return (
                  <View key={user.id} style={styles.memberItem}>
                    <View style={styles.memberAvatarWrap}>
                      <Avatar url={avatarUrl} headers={imageHeaders} username={user.username} size={40} />
                      <View style={[styles.statusDot, {backgroundColor: statusColor(status?.status)}]} />
                    </View>
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName}>
                        {user.first_name || user.last_name
                          ? `${user.first_name} ${user.last_name}`.trim()
                          : user.username}
                      </Text>
                      <Text style={styles.memberHandle}>@{user.username}</Text>
                      {user.position ? (
                        <Text style={styles.memberPosition}>{user.position}</Text>
                      ) : null}
                    </View>
                    {user.id === currentUserId && (
                      <Text style={styles.memberYou}>You</Text>
                    )}
                  </View>
                );
              })}
              {channel.type !== 'D' && (
                <TouchableOpacity
                  style={styles.addMemberButton}
                  onPress={() => setShowAddMember(true)}>
                  <Text style={styles.addMemberText}>+ Add Member</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {tab === 'pinned' && (
            <View>
              {pinnedPosts.length === 0 ? (
                <View style={styles.centered}>
                  <Text style={styles.emptyText}>No pinned messages</Text>
                  <Text style={styles.emptyHint}>Pin important messages to find them here</Text>
                </View>
              ) : (
                pinnedPosts.map((post) => {
                  const author = members.find((m) => m.user.id === post.user_id)?.user;
                  return (
                    <View key={post.id} style={styles.pinnedItem}>
                      <Text style={styles.pinnedAuthor}>
                        {author?.username || 'unknown'}
                      </Text>
                      <Text style={styles.pinnedMessage} numberOfLines={6}>
                        {post.message}
                      </Text>
                      <Text style={styles.pinnedTime}>
                        {formatFullDateTime(post.create_at)}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* Add Member Modal */}
      <Modal visible={showAddMember} transparent animationType="slide" onRequestClose={() => setShowAddMember(false)}>
        <View style={styles.dmModalOverlay}>
          <View style={styles.dmModalContent}>
            <View style={styles.dmModalHeader}>
              <Text style={styles.dmModalTitle}>Add Member</Text>
              <TouchableOpacity onPress={() => setShowAddMember(false)}>
                <Text style={styles.dmModalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.dmSearchInput}
              placeholder="Search users..."
              placeholderTextColor="#6b7ca0"
              value={memberQuery}
              onChangeText={searchMembers}
              autoFocus
              autoCapitalize="none"
            />
            {memberSearching && <ActivityIndicator color={theme.linkColor} style={{marginVertical: 12}} />}
            <ScrollView style={{maxHeight: 300}}>
              {memberResults.map((user) => {
                const avatarUrl = client.getProfileImageUrl(user.id, user.last_picture_update);
                return (
                  <TouchableOpacity
                    key={user.id}
                    style={styles.dmUserItem}
                    onPress={() => addMember(user)}>
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
              {!memberSearching && memberQuery.length >= 2 && memberResults.length === 0 && (
                <Text style={styles.emptyText}>No users found</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.sidebarBg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: theme.sidebarHeaderBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: changeOpacity(theme.sidebarText, 0.15),
  },
  headerPane: {
    paddingTop: 12,
  },
  closeButton: {
    padding: 4,
  },
  closeText: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 20,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  channelHeader: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    backgroundColor: theme.sidebarHeaderBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: changeOpacity(theme.sidebarText, 0.15),
  },
  channelIconLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: changeOpacity(theme.sidebarText, 0.1),
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  channelIconText: {
    fontSize: 28,
  },
  channelDisplayName: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  channelType: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 13,
    marginTop: 4,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: theme.sidebarHeaderBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: changeOpacity(theme.sidebarText, 0.15),
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: theme.buttonBg,
  },
  tabText: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#fff',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  infoSection: {
    marginBottom: 20,
  },
  infoLabel: {
    color: changeOpacity(theme.sidebarText, 0.5),
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  infoContent: {
    backgroundColor: changeOpacity(theme.sidebarText, 0.1),
    borderRadius: 8,
    padding: 12,
  },
  infoText: {
    color: '#ccc',
    fontSize: 14,
    lineHeight: 20,
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: changeOpacity(theme.sidebarText, 0.15),
  },
  memberAvatarWrap: {
    position: 'relative',
    marginRight: 12,
  },
  statusDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.sidebarHeaderBg,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  memberHandle: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 13,
  },
  memberPosition: {
    color: changeOpacity(theme.sidebarText, 0.5),
    fontSize: 12,
    marginTop: 2,
  },
  memberYou: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 12,
    fontStyle: 'italic',
  },
  pinnedItem: {
    backgroundColor: changeOpacity(theme.sidebarText, 0.1),
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  pinnedAuthor: {
    color: theme.linkColor,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  pinnedMessage: {
    color: '#ccc',
    fontSize: 14,
    lineHeight: 19,
  },
  pinnedTime: {
    color: changeOpacity(theme.sidebarText, 0.5),
    fontSize: 11,
    marginTop: 6,
  },
  leaveButton: {
    backgroundColor: 'rgba(224, 108, 117, 0.15)',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
    borderWidth: 1,
    borderColor: 'rgba(224, 108, 117, 0.3)',
  },
  leaveText: {
    color: theme.errorTextColor,
    fontSize: 15,
    fontWeight: '600',
  },
  emptyText: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 15,
    fontWeight: '600',
  },
  emptyHint: {
    color: changeOpacity(theme.sidebarText, 0.5),
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  addMemberButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.linkColor,
    borderRadius: 8,
  },
  addMemberText: {
    color: theme.linkColor,
    fontSize: 14,
    fontWeight: '600',
  },
  notifyOption: {
    marginTop: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: changeOpacity(theme.sidebarText, 0.08),
  },
  notifyOptionActive: {
    backgroundColor: theme.sidebarTextActiveBorder,
  },
  notifyOptionText: {
    color: changeOpacity(theme.sidebarText, 0.8),
    fontSize: 14,
  },
  notifyOptionTextActive: {
    color: theme.sidebarTextActiveColor,
    fontWeight: '600',
  },
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
