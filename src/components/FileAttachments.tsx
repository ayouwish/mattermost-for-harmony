/**
 * FileAttachment component — renders file/image attachments in messages.
 *
 * Shows inline image previews for image files, and file cards for other types.
 */
import React from 'react';
import {Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import type {FileInfo} from '../api/types';
import {type MattermostClient} from '../api/client';

interface Props {
  client: MattermostClient;
  files: FileInfo[];
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'];

function isImage(file: FileInfo): boolean {
  return IMAGE_EXTENSIONS.includes(file.extension.toLowerCase());
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FILE_ICONS: Record<string, string> = {
  pdf: '📄',
  doc: '📄', docx: '📄',
  xls: '📊', xlsx: '📊', csv: '📊',
  ppt: '📽️', pptx: '📽️',
  zip: '🗜️', rar: '🗜️', '7z': '🗜️', tar: '🗜️', gz: '🗜️',
  mp3: '🎵', wav: '🎵', m4a: '🎵', ogg: '🎵',
  mp4: '🎬', webm: '🎬', mov: '🎬', avi: '🎬',
  txt: '📝', md: '📝',
  js: '📜', ts: '📜', py: '📜', java: '📜', go: '📜', rs: '📜',
  json: '📋', xml: '📋', yaml: '📋', yml: '📋',
};

function getFileIcon(ext: string): string {
  return FILE_ICONS[ext.toLowerCase()] || '📎';
}

export function FileAttachments({client, files}: Props) {
  if (!files || files.length === 0) return null;

  const images = files.filter(isImage);
  const otherFiles = files.filter((f) => !isImage(f));

  return (
    <View style={styles.container}>
      {/* Image grid */}
      {images.length > 0 && (
        <View style={styles.imageGrid}>
          {images.map((file) => {
            const baseUrl = client.getServerUrl();
            const tokenSuffix = client.getToken()
              ? `?Authorization=Bearer+${encodeURIComponent(client.getToken()!)}`
              : '';
            const url = `${baseUrl}/api/v4/files/${file.id}/thumbnail${tokenSuffix}`;
            return (
              <TouchableOpacity
                key={file.id}
                style={[
                  styles.imageCell,
                  images.length === 1 && styles.imageCellSingle,
                ]}
                onPress={() => {
                  // TODO: open full-screen image viewer
                }}
                activeOpacity={0.8}>
                <Image
                  source={{uri: url}}
                  style={[
                    styles.image,
                    images.length === 1 && styles.imageSingle,
                  ]}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* File cards */}
      {otherFiles.map((file) => (
        <View key={file.id} style={styles.fileCard}>
          <Text style={styles.fileIcon}>{getFileIcon(file.extension)}</Text>
          <View style={styles.fileInfo}>
            <Text style={styles.fileName} numberOfLines={1}>
              {file.name}
            </Text>
            <Text style={styles.fileSize}>
              {formatFileSize(file.size)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  imageCell: {
    width: 120,
    height: 120,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  imageCellSingle: {
    width: 240,
    height: 200,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageSingle: {
    width: '100%',
    height: '100%',
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
  },
  fileIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    color: '#8ecbff',
    fontSize: 14,
    fontWeight: '500',
  },
  fileSize: {
    color: '#5a6a8a',
    fontSize: 12,
    marginTop: 2,
  },
});

export default FileAttachments;
