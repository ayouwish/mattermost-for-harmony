/**
 * LinkPreview + inline-image components
 *
 * Renders Mattermost post metadata.embeds (opengraph / permalink /
 * message_attachment) as tappable cards, and bare image URLs found in the
 * message body as inline previews. Opening a card delegates to the system
 * browser via openLink.
 */
import React, {useEffect, useState} from 'react';
import {Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import type {PostEmbed} from '../api/types';
import {theme, changeOpacity} from '../theme/utils';
import {fetchImageAsDataUri} from '../utils/imageDataUri';

interface Props {
  embeds: PostEmbed[];
  /** Server origin used to resolve relative URLs (www.thread links etc.). */
  serverUrl?: string;
  onOpen: (url: string) => void;
}

function resolveUrl(url: string, serverUrl?: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (serverUrl) return `${serverUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  return url;
}

function EmbedThumb({src}: {src: string}) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setUri(null);
    fetchImageAsDataUri(src).then((d) => {
      if (!cancelled) setUri(d);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);
  if (!uri) return <View style={styles.thumb} />;
  return <Image source={{uri}} style={styles.thumb} resizeMode="cover" />;
}

/** OpenGraph card: thumbnail + title + site + description. */
function OpenGraphCard({embed, serverUrl, onOpen}: Omit<Props, 'embeds'> & {embed: PostEmbed}) {
  const targetUrl = resolveUrl(embed.data?.url || embed.url, serverUrl);
  const imageUrl = embed.data?.image_url ? resolveUrl(embed.data.image_url, serverUrl) : null;
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => onOpen(targetUrl)}>
      <View style={styles.cardBody}>
        {imageUrl ? <EmbedThumb src={imageUrl} /> : null}
        <View style={styles.cardText}>
          {embed.data?.site_name ? (
            <Text style={styles.siteName} numberOfLines={1}>{embed.data.site_name}</Text>
          ) : null}
          {embed.data?.title ? (
            <Text style={styles.title} numberOfLines={2}>{embed.data.title}</Text>
          ) : null}
          {embed.data?.description ? (
            <Text style={styles.description} numberOfLines={3}>{embed.data.description}</Text>
          ) : null}
          <Text style={styles.domain} numberOfLines={1}>{targetUrl}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

/** Permalink card: quote of another post/channel. */
function PermalinkCard({embed, serverUrl, onOpen}: Omit<Props, 'embeds'> & {embed: PostEmbed}) {
  const targetUrl = resolveUrl(embed.url, serverUrl);
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => onOpen(targetUrl)}>
      <View style={styles.cardBody}>
        <View style={styles.cardText}>
          <Text style={styles.siteName}>🔗 Message</Text>
          {embed.data?.channel_display_name ? (
            <Text style={styles.title} numberOfLines={1}>{embed.data.channel_display_name}</Text>
          ) : null}
          {embed.data?.post_create_at ? (
            <Text style={styles.description}>
              {new Date(embed.data.post_create_at).toLocaleString()}
            </Text>
          ) : null}
          <Text style={styles.domain} numberOfLines={1}>{targetUrl}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

/** message_attachment embed: plain text block. */
function AttachmentCard({embed, onOpen}: Omit<Props, 'embeds'> & {embed: PostEmbed}) {
  const text = embed.data?.message || embed.data?.fallback || embed.data?.text || '';
  return (
    <TouchableOpacity style={styles.attachmentCard} activeOpacity={0.7} onPress={() => onOpen(embed.url)}>
      <Text style={styles.description}>{text}</Text>
    </TouchableOpacity>
  );
}

export function LinkPreview({embeds, serverUrl, onOpen}: Props) {
  if (!embeds || embeds.length === 0) return null;
  return (
    <View style={styles.container}>
      {embeds.map((embed, index) => {
        switch (embed.type) {
          case 'opengraph':
            return <OpenGraphCard key={index} embed={embed} serverUrl={serverUrl} onOpen={onOpen} />;
          case 'permalink':
            return <PermalinkCard key={index} embed={embed} serverUrl={serverUrl} onOpen={onOpen} />;
          default:
            return <AttachmentCard key={index} embed={embed} onOpen={onOpen} />;
        }
      })}
    </View>
  );
}

const IMAGE_URL_RE = /https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|bmp)(?:\?[^\s<>"']*)?/gi;

/** Inline previews of bare image URLs in the message body. */
export function InlineImagePreviews({message, onOpen}: {message: string; onOpen: (url: string) => void}) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const matched = message.match(IMAGE_URL_RE) || [];
    setUrls([...new Set(matched)].slice(0, 4));
  }, [message]);
  if (urls.length === 0) return null;
  return (
    <View style={styles.inlineWrap}>
      {urls.map((url) => (
        <InlineImage key={url} url={url} onOpen={onOpen} />
      ))}
    </View>
  );
}

function InlineImage({url, onOpen}: {url: string; onOpen: (url: string) => void}) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setUri(null);
    fetchImageAsDataUri(url).then((d) => {
      if (!cancelled) setUri(d);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return (
    <TouchableOpacity style={styles.inlineTouch} activeOpacity={0.8} disabled={!uri} onPress={() => onOpen(url)}>
      {uri ? (
        <Image source={{uri}} style={styles.inlineImage} resizeMode="cover" />
      ) : (
        <View style={styles.inlinePlaceholder} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 6,
  },
  card: {
    backgroundColor: changeOpacity(theme.centerChannelBg, 0.35),
    borderLeftWidth: 3,
    borderLeftColor: theme.linkColor,
    borderRadius: 8,
    marginTop: 6,
    overflow: 'hidden',
  },
  cardBody: {
    flexDirection: 'row',
    padding: 10,
  },
  cardText: {
    flex: 1,
    justifyContent: 'center',
  },
  thumb: {
    width: 88,
    height: 88,
    borderRadius: 6,
    marginRight: 10,
    backgroundColor: changeOpacity(theme.centerChannelBg, 0.45),
  },
  siteName: {
    color: changeOpacity(theme.centerChannelColor, 0.55),
    fontSize: 11,
    textTransform: 'uppercase',
  },
  title: {
    color: theme.linkColor,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  description: {
    color: theme.centerChannelColor,
    fontSize: 12,
    marginTop: 2,
  },
  domain: {
    color: changeOpacity(theme.centerChannelColor, 0.45),
    fontSize: 11,
    marginTop: 4,
  },
  attachmentCard: {
    backgroundColor: changeOpacity(theme.centerChannelBg, 0.35),
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
  },
  inlineWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  inlineTouch: {
    width: 120,
    height: 120,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: changeOpacity(theme.centerChannelBg, 0.3),
  },
  inlineImage: {
    width: '100%',
    height: '100%',
  },
  inlinePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: changeOpacity(theme.centerChannelBg, 0.3),
  },
});

export default LinkPreview;