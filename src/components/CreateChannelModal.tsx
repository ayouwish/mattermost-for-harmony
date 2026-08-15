/**
 * CreateChannelModal — modal dialog for creating a public/private channel.
 *
 * Shared by the wide-screen TopBar (＋) and the phone channel-list header (＋).
 */
import React, {useState} from 'react';
import {Modal, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {type MattermostClient} from '../api/client';
import type {Channel} from '../api/types';
import {theme, changeOpacity} from '../theme/utils';

interface Props {
  visible: boolean;
  client: MattermostClient;
  teamId: string | null;
  onClose: () => void;
  onChannelCreated: (channel: Channel) => void;
}

export default function CreateChannelModal({
  visible,
  client,
  teamId,
  onClose,
  onChannelCreated,
}: Props) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [type, setType] = useState<'O' | 'P'>('O');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!teamId || !displayName.trim()) return;
    setCreating(true);
    try {
      const channel = await client.createChannel({
        team_id: teamId,
        name: name.trim().toLowerCase().replace(/\s+/g, '-') || displayName.trim().toLowerCase().replace(/\s+/g, '-'),
        display_name: displayName.trim(),
        type,
        purpose: purpose.trim() || undefined,
      });
      setName('');
      setDisplayName('');
      setPurpose('');
      onChannelCreated(channel);
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>New Channel</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Display name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Product Updates"
            placeholderTextColor="#6b7ca0"
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
          />

          <Text style={styles.label}>URL name (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="auto-generated if empty"
            placeholderTextColor="#6b7ca0"
            value={name}
            onChangeText={setName}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Purpose (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="What's this channel about?"
            placeholderTextColor="#6b7ca0"
            value={purpose}
            onChangeText={setPurpose}
          />

          <View style={styles.typeRow}>
            <TouchableOpacity
              style={[styles.typeButton, type === 'O' && styles.typeButtonActive]}
              onPress={() => setType('O')}>
              <Text style={[styles.typeButtonText, type === 'O' && styles.typeButtonTextActive]}>Public</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeButton, type === 'P' && styles.typeButtonActive]}
              onPress={() => setType('P')}>
              <Text style={[styles.typeButtonText, type === 'P' && styles.typeButtonTextActive]}>Private</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.createButton, (!displayName.trim() || creating) && {opacity: 0.5}]}
            onPress={handleCreate}
            disabled={!displayName.trim() || creating}>
            <Text style={styles.createButtonText}>
              {creating ? 'Creating...' : 'Create Channel'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    backgroundColor: theme.sidebarHeaderBg,
    borderRadius: 12,
    width: '90%',
    maxHeight: '70%',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    color: theme.sidebarHeaderTextColor,
    fontSize: 18,
    fontWeight: '700',
  },
  close: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 20,
  },
  input: {
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
  label: {
    color: changeOpacity(theme.sidebarText, 0.6),
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  typeRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: changeOpacity(theme.sidebarText, 0.1),
    marginHorizontal: 4,
  },
  typeButtonActive: {
    backgroundColor: theme.sidebarTextActiveBorder,
  },
  typeButtonText: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 13,
    fontWeight: '600',
  },
  typeButtonTextActive: {
    color: theme.sidebarTextActiveColor,
  },
  createButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: theme.buttonBg,
    borderRadius: 8,
  },
  createButtonText: {
    color: theme.buttonColor,
    fontSize: 15,
    fontWeight: '600',
  },
});
