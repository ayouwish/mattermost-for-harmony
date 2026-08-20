/**
 * FileAttachment component — renders file/image attachments in messages.
 *
 * - A single image renders at full width using the full-resolution `/image`
 *   endpoint (aspect ratio preserved), capped in height.
 * - Multiple images render as a thumbnail grid.
 * - Tapping any image opens a full-screen viewer.
 * - Non-image files render as file cards.
 *
 * Images are downloaded with an authenticated fetch (RNOH's <Image> pipeline
 * ignores source.headers → 401) and rendered as data: URIs.
 */
import React, {useEffect, useState} from 'react';
import {Alert, Dimensions, Image, Modal, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import type {FileInfo} from '../api/types';
import {type MattermostClient} from '../api/client';

interface Props {
  client: MattermostClient;
  files: FileInfo[];
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac'];

// Max height a single inline image can occupy before the user taps to view
// the full image full-screen.
const MAX_SINGLE_HEIGHT = 360;

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

function SingleImage({client, file, onPress}: {client: MattermostClient; file: FileInfo; onPress: () => void}) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    client.getFileImageDataUri(file.id, 'image').then((d) => {
      if (!cancelled) setUri(d);
    });
    return () => {
      cancelled = true;
    };
  }, [client, file.id]);

  // Aspect ratio from the file metadata (fallback 1:1 if unknown).
  const ratio = file.width > 0 && file.height > 0 ? file.width / file.height : 1;
  const width = Math.min(Dimensions.get('window').width - 120, 680);
  const height = Math.min(Math.round(width / ratio), MAX_SINGLE_HEIGHT);

  return (
    <View style={styles.singleWrap}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.8} disabled={!uri}>
        {uri ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image style={{width, height, maxWidth: '100%', borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.15)'}} resizeMode="contain" source={{uri}} />
        ) : (
          <View style={[styles.imageFallback, {width, height}]} />
        )}
      </TouchableOpacity>
      <Text style={styles.imageCaption} numberOfLines={1}>
        {file.name} · {formatFileSize(file.size)}
      </Text>
    </View>
  );
}

function GridImage({client, file, onPress}: {client: MattermostClient; file: FileInfo; onPress: () => void}) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    client.getFileImageDataUri(file.id, 'thumbnail').then((d) => {
      if (!cancelled) setUri(d);
    });
    return () => {
      cancelled = true;
    };
  }, [client, file.id]);

  return (
    <TouchableOpacity style={styles.imageCell} onPress={onPress} activeOpacity={0.8} disabled={!uri}>
      {uri ? (
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image style={styles.image} resizeMode="cover" source={{uri}} />
      ) : (
        <View style={styles.imageFallback} />
      )}
    </TouchableOpacity>
  );
}

export function FileAttachments({client, files}: Props) {
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  if (!files || files.length === 0) return null;

  const images = files.filter(isImage);
  const mediaFiles = files.filter((f) => !isImage(f) && (VIDEO_EXTENSIONS.includes(f.extension.toLowerCase()) || AUDIO_EXTENSIONS.includes(f.extension.toLowerCase())));
  const otherFiles = files.filter((f) => !isImage(f) && !(VIDEO_EXTENSIONS.includes(f.extension.toLowerCase()) || AUDIO_EXTENSIONS.includes(f.extension.toLowerCase())));

  return (
    <View style={styles.container}>
      {/* Single image: full-width, aspect-ratio preserved */}
      {images.length === 1 && (
        <SingleImage client={client} file={images[0]} onPress={() => {
          client.getFileImageDataUri(images[0].id, 'image').then((d) => setViewerUri(d));
        }} />
      )}

      {/* Multiple images: thumbnail grid */}
      {images.length > 1 && (
        <View style={styles.imageGrid}>
          {images.map((file) => (
            <GridImage
              key={file.id}
              client={client}
              file={file}
              onPress={() => {
                client.getFileImageDataUri(file.id, 'image').then((d) => setViewerUri(d));
              }}
            />
          ))}
        </View>
      )}

      {/* Audio/video media cards */}
      {mediaFiles.map((file) => (
        <TouchableOpacity
          key={file.id}
          style={styles.mediaCard}
          activeOpacity={0.7}
          onPress={() =>
            Alert.alert(
              'Playback not available yet',
              `"${file.name}" — the in-app media player is coming in a later phase. Use the desktop app to play it for now.`,
            )
          }>
          <View style={styles.mediaIconWrap}>
            <Text style={styles.mediaIcon}>
              {VIDEO_EXTENSIONS.includes(file.extension.toLowerCase()) ? '▶️' : '🎵'}
            </Text>
          </View>
          <View style={styles.fileInfo}>
            <Text style={styles.fileName} numberOfLines={1}>
              {file.name}
            </Text>
            <Text style={styles.fileSize}>
              {formatFileSize(file.size)}
            </Text>
          </View>
        </TouchableOpacity>
      ))}

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

      {/* Full-screen image viewer */}
      <Modal
        visible={viewerUri !== null}
        animationType="fade"
        transparent={false}
        onRequestClose={() => setViewerUri(null)}>
        {viewerUri && (
          <View style={styles.viewer}>
            <TouchableOpacity style={styles.viewerClose} onPress={() => setViewerUri(null)} activeOpacity={0.7}>
              <Text style={styles.viewerCloseText}>✕</Text>
            </TouchableOpacity>
            <Image
              source={{uri: viewerUri}}
              style={styles.viewerImage}
              resizeMode="contain"
            />
            <Text style={styles.viewerCaption} numberOfLines={1}>
              {images.length === 1 ? images[0].name : 'Image'}
            </Text>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  singleWrap: {
    alignSelf: 'flex-start',
  },
  imageCaption: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    marginTop: 4,
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
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0,0,0,0.15)',
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
  mediaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
  },
  mediaIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(24,104,219,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  mediaIcon: {
    fontSize: 20,
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
  viewer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerClose: {
    position: 'absolute',
    top: 44,
    right: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerCloseText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  viewerImage: {
    width: '100%',
    height: '80%',
  },
  viewerCaption: {
    color: '#ccc',
    fontSize: 14,
    marginTop: 12,
    paddingHorizontal: 24,
  },
});

export default FileAttachments;