/**
 * Lightweight Markdown renderer for Mattermost messages.
 *
 * Zero-dependency, RN-friendly parser. Supports:
 * - **bold**, *italic*, ~~strike~~, `inline code`
 * - ```code blocks```
 * - [links](url)
 * - > blockquotes
 * - - / 1. lists
 * - @mentions, ~channel mentions
 * - :emoji: shortcodes
 *
 * Not a full CommonMark implementation — optimized for chat messages.
 */
import React from 'react';
import {Linking, StyleSheet, Text, View} from 'react-native';
import {theme, changeOpacity} from '../theme/utils';

// ── Emoji shortcode map (common set) ──
const EMOJI_MAP: Record<string, string> = {
  '+1': '👍', '-1': '👎', '100': '💯', '1234': '🔢',
  smile: '😄', smiley: '😃', grin: '😁', laugh: '😆',
  wink: '😉', blush: '😊', yum: '😋', heart_eyes: '😍',
  kiss: '😘', stuck_out_tongue: '😛', thinking: '🤔',
  neutral_face: '😐', expressionless: '😑', unamused: '😒',
  rolling_eyes: '🙄', smirk: '😏', relieved: '😌', pensive: '😔',
  cry: '😢', sob: '😭', heart: '❤️', broken_heart: '💔',
  fire: '🔥', thumbsup: '👍', thumbsdown: '👎', ok_hand: '👌',
  clap: '👏', raised_hands: '🙌', pray: '🙏', wave: '👋',
  rocket: '🚀', tada: '🎉', warning: '⚠️', white_check_mark: '✅',
  x: '❌', question: '❓', exclamation: '❗', check: '✔️',
  beer: '🍺', coffee: '☕', pizza: '🍕', cake: '🎂',
  sunglasses: '😎', facepalm: '🤦', shrug: '🤷', party: '🥳',
  star: '⭐', sparkles: '✨', hammer: '🔨', wrench: '🔧',
  memo: '📝', book: '📖', bulb: '💡', target: '🎯',
};

function emojiFromShortcode(name: string): string {
  const key = name.toLowerCase().replace(/[-\s]/g, '_');
  return EMOJI_MAP[key] || `:${name}:`;
}

// ── Inline parsing ──

type InlineNode =
  | {type: 'text'; text: string}
  | {type: 'bold'; children: InlineNode[]}
  | {type: 'italic'; children: InlineNode[]}
  | {type: 'strike'; children: InlineNode[]}
  | {type: 'code'; text: string}
  | {type: 'link'; url: string; text: string}
  | {type: 'mention'; text: string}
  | {type: 'channel'; text: string}
  | {type: 'emoji'; text: string};

/**
 * Parse a single line of inline markdown into styled nodes.
 * Handles nested bold/italic by recursive descent.
 */
function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let i = 0;
  let buffer = '';

  const flush = () => {
    if (buffer) {
      nodes.push({type: 'text', text: buffer});
      buffer = '';
    }
  };

  while (i < text.length) {
    const remaining = text.slice(i);

    // Code span: `...`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      flush();
      nodes.push({type: 'code', text: codeMatch[1]});
      i += codeMatch[0].length;
      continue;
    }

    // Code block: ```...```
    const codeBlockMatch = remaining.match(/^```([\s\S]*?)```/);
    if (codeBlockMatch) {
      flush();
      nodes.push({type: 'code', text: codeBlockMatch[1]});
      i += codeBlockMatch[0].length;
      continue;
    }

    // Bold: **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      flush();
      nodes.push({type: 'bold', children: parseInline(boldMatch[1])});
      i += boldMatch[0].length;
      continue;
    }

    // Italic: *text* (avoid matching ** which is bold)
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch && text[i] === '*' && text[i + 1] !== '*') {
      flush();
      nodes.push({type: 'italic', children: parseInline(italicMatch[1])});
      i += italicMatch[0].length;
      continue;
    }

    // Strikethrough: ~~text~~
    const strikeMatch = remaining.match(/^~~([^~]+)~~/);
    if (strikeMatch) {
      flush();
      nodes.push({type: 'strike', children: parseInline(strikeMatch[1])});
      i += strikeMatch[0].length;
      continue;
    }

    // Link: [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
    if (linkMatch) {
      flush();
      nodes.push({type: 'link', text: linkMatch[1], url: linkMatch[2]});
      i += linkMatch[0].length;
      continue;
    }

    // Mention: @word
    const mentionMatch = remaining.match(/^@([a-zA-Z0-9._-]+)/);
    if (mentionMatch) {
      flush();
      nodes.push({type: 'mention', text: mentionMatch[0]});
      i += mentionMatch[0].length;
      continue;
    }

    // Channel mention: ~word
    const channelMatch = remaining.match(/^~([a-zA-Z0-9._-]+)/);
    if (channelMatch) {
      flush();
      nodes.push({type: 'channel', text: channelMatch[0]});
      i += channelMatch[0].length;
      continue;
    }

    // Emoji shortcode: :name:
    const emojiMatch = remaining.match(/^:([a-zA-Z0-9_+-]+):/);
    if (emojiMatch) {
      flush();
      nodes.push({type: 'emoji', text: emojiFromShortcode(emojiMatch[1])});
      i += emojiMatch[0].length;
      continue;
    }

    buffer += text[i];
    i++;
  }

  flush();
  return nodes;
}

function renderInlineNode(node: InlineNode, key: number): React.ReactNode {
  switch (node.type) {
    case 'text':
      return <Text key={key}>{node.text}</Text>;
    case 'bold':
      return (
        <Text key={key} style={mdStyles.bold}>
          {node.children.map((c, i) => renderInlineNode(c, i))}
        </Text>
      );
    case 'italic':
      return (
        <Text key={key} style={mdStyles.italic}>
          {node.children.map((c, i) => renderInlineNode(c, i))}
        </Text>
      );
    case 'strike':
      return (
        <Text key={key} style={mdStyles.strike}>
          {node.children.map((c, i) => renderInlineNode(c, i))}
        </Text>
      );
    case 'code':
      return <Text key={key} style={mdStyles.inlineCode}>{node.text}</Text>;
    case 'link':
      return (
        <Text
          key={key}
          style={mdStyles.link}
          onPress={() => {
            Linking.openURL(node.url).catch(() => {});
          }}>
          {node.text}
        </Text>
      );
    case 'mention':
      return <Text key={key} style={mdStyles.mention}>{node.text}</Text>;
    case 'channel':
      return <Text key={key} style={mdStyles.channelMention}>{node.text}</Text>;
    case 'emoji':
      return <Text key={key}>{node.text}</Text>;
    default:
      return null;
  }
}

function renderInline(nodes: InlineNode[]): React.ReactNode {
  return nodes.map((node, i) => renderInlineNode(node, i));
}

/**
 * Parse a Markdown table row like `| a | b | c |` into cells.
 * Splits on unescaped pipes and trims each cell.
 */
function parseTableRow(row: string): string[] {
  const trimmed = row.trim();
  if (!trimmed.startsWith('|')) return [];
  // Remove leading/trailing pipes, then split on internal pipes.
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '').trim();
  if (!inner) return [];
  return inner.split('|').map((c) => c.trim());
}

// ── Lightweight syntax highlighting ──

const CODE_KEYWORDS = [
  'function', 'return', 'if', 'else', 'for', 'while', 'const', 'let', 'var',
  'import', 'export', 'from', 'default', 'class', 'new', 'try', 'catch',
  'throw', 'async', 'await', 'true', 'false', 'null', 'undefined', 'this',
  'switch', 'case', 'break', 'continue', 'type', 'interface', 'extends',
  'implements', 'public', 'private', 'static', 'readonly', 'enum', 'void',
  'def', 'elif', 'lambda', 'None', 'True', 'False', 'and', 'or', 'not', 'in',
  'is', 'print', 'yield', 'with', 'as', 'pass', 'raise', 'global', 'finally',
  'package', 'require', 'module', 'exports', 'typeof', 'instanceof', 'delete',
];

/**
 * Minimal tokenizer-based highlighter for common languages.
 * Colors: keywords (blue), strings (green), comments (gray), numbers (orange).
 * Falls back to plain text for unknown tokens.
 */
function highlightCode(code: string, lang: string = ''): React.ReactNode {
  const lines = code.split('\n');
  return lines.map((line, li) => {
    const tokens: React.ReactNode[] = [];
    let i = 0;
    let buffer = '';
    const flush = (key: number) => {
      if (buffer) {
        tokens.push(<Text key={`b-${key}`} style={mdStyles.codeToken}>{buffer}</Text>);
        buffer = '';
      }
    };
    let key = 0;

    while (i < line.length) {
      // Comment: // or #
      const comment = line.slice(i).match(/^(\/\/|#).*/);
      if (comment) {
        flush(key++);
        tokens.push(<Text key={key++} style={mdStyles.codeComment}>{comment[0]}</Text>);
        i += comment[0].length;
        continue;
      }
      // String: "..." or '...' or `...`
      const str = line.slice(i).match(/^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`)/);
      if (str) {
        flush(key++);
        tokens.push(<Text key={key++} style={mdStyles.codeString}>{str[0]}</Text>);
        i += str[0].length;
        continue;
      }
      // Number
      const num = line.slice(i).match(/^\d[\w.]*/);
      if (num) {
        flush(key++);
        tokens.push(<Text key={key++} style={mdStyles.codeNumber}>{num[0]}</Text>);
        i += num[0].length;
        continue;
      }
      // Keyword / identifier
      const word = line.slice(i).match(/^[A-Za-z_$][\w$]*/);
      if (word) {
        const w = word[0];
        if (CODE_KEYWORDS.includes(w)) {
          flush(key++);
          tokens.push(<Text key={key++} style={mdStyles.codeKeyword}>{w}</Text>);
        } else {
          buffer += w;
        }
        i += w.length;
        continue;
      }
      // Block comment opener /** ... */
      if (line.slice(i).startsWith('/**')) {
        flush(key++);
        const rest = line.slice(i);
        tokens.push(<Text key={key++} style={mdStyles.codeComment}>{rest}</Text>);
        i = line.length;
        continue;
      }
      buffer += line[i];
      i++;
    }
    flush(key++);
    return <Text key={`l-${li}`}>{tokens}</Text>;
  });
}

// ── Block-level parsing ──

interface MarkdownProps {
  text: string;
  style?: any;
}

export const Markdown = React.memo(function Markdown({text, style}: MarkdownProps) {
  if (!text) {
    return null;
  }

  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockLang = '';
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushList = () => {
    if (listItems.length > 0 && listType) {
      blocks.push(
        <View key={`list-${blocks.length}`} style={mdStyles.list}>
          {listItems.map((item, idx) => (
            <View key={idx} style={mdStyles.listItem}>
              <Text style={mdStyles.bullet}>
                {listType === 'ol' ? `${idx + 1}.` : '•'}
              </Text>
              <Text style={mdStyles.listText}>
                {renderInline(parseInline(item))}
              </Text>
            </View>
          ))}
        </View>,
      );
      listItems = [];
      listType = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code fence: ```
    const fenceMatch = line.match(/^```(\w*)/);
    if (fenceMatch) {
      if (inCodeBlock) {
        // Close code block
        blocks.push(
          <View key={`code-${blocks.length}`} style={mdStyles.codeBlock}>
            <Text style={mdStyles.codeText}>
              {highlightCode(codeBlockLines.join('\n'), codeBlockLang)}
            </Text>
          </View>,
        );
        inCodeBlock = false;
        codeBlockLines = [];
        codeBlockLang = '';
      } else {
        flushList();
        inCodeBlock = true;
        codeBlockLang = fenceMatch[1] || '';
        codeBlockLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Table: detect a header row starting with '|' or '+-' and collect rows
    if (line.trim().startsWith('|')) {
      const tableLines: string[] = [line];
      let j = i + 1;
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        tableLines.push(lines[j]);
        j++;
      }
      if (tableLines.length >= 2) {
        // Parse header + separator + data rows
        const header = parseTableRow(tableLines[0]);
        const separator = tableLines[1].trim().startsWith('|') ? tableLines[1] : '';
        const dataRows = (separator ? tableLines.slice(2) : tableLines.slice(1))
          .map((r) => parseTableRow(r))
          .filter((r) => r.length > 0);

        if (header.length > 0 && (separator || dataRows.length > 0)) {
          flushList();
          blocks.push(
            <View key={`table-${blocks.length}`} style={mdStyles.table}>
              <View style={mdStyles.tableRow}>
                {header.map((cell, idx) => (
                  <View key={`th-${idx}`} style={mdStyles.tableHeaderCell}>
                    <Text style={mdStyles.tableHeaderText}>
                      {renderInline(parseInline(cell))}
                    </Text>
                  </View>
                ))}
              </View>
              {dataRows.map((row, ridx) => (
                <View key={`tr-${ridx}`} style={mdStyles.tableRow}>
                  {row.map((cell, cidx) => (
                    <View key={`td-${cidx}`} style={mdStyles.tableCell}>
                      <Text style={mdStyles.tableCellText}>
                        {renderInline(parseInline(cell))}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>,
          );
          i = j - 1;
          continue;
        }
      }
    }

    // Headings: # ## ###
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const headingStyle =
        level === 1 ? mdStyles.h1 : level === 2 ? mdStyles.h2 : mdStyles.h3;
      blocks.push(
        <Text key={`h-${blocks.length}`} style={headingStyle}>
          {renderInline(parseInline(headingMatch[2]))}
        </Text>,
      );
      continue;
    }

    // Horizontal rule: --- or ***
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flushList();
      blocks.push(<View key={`hr-${blocks.length}`} style={mdStyles.hr} />);
      continue;
    }

    // Blockquote: >
    const quoteMatch = line.match(/^>\s*(.*)/);
    if (quoteMatch) {
      flushList();
      blocks.push(
        <View key={`quote-${blocks.length}`} style={mdStyles.quote}>
          <Text style={mdStyles.quoteText}>
            {renderInline(parseInline(quoteMatch[1]))}
          </Text>
        </View>,
      );
      continue;
    }

    // Unordered list: - or *
    const ulMatch = line.match(/^[-*]\s+(.+)/);
    if (ulMatch) {
      if (listType && listType !== 'ul') {
        flushList();
      }
      listType = 'ul';
      listItems.push(ulMatch[1]);
      continue;
    }

    // Ordered list: 1.
    const olMatch = line.match(/^\d+\.\s+(.+)/);
    if (olMatch) {
      if (listType && listType !== 'ol') {
        flushList();
      }
      listType = 'ol';
      listItems.push(olMatch[1]);
      continue;
    }

    // Regular paragraph
    flushList();
    if (line.trim() === '') {
      blocks.push(<Text key={`br-${blocks.length}`} style={mdStyles.text}>{' '}</Text>);
    } else {
      blocks.push(
        <Text key={`p-${blocks.length}`} style={mdStyles.text}>
          {renderInline(parseInline(line))}
        </Text>,
      );
    }
  }

  // Flush remaining
  if (inCodeBlock && codeBlockLines.length > 0) {
    blocks.push(
      <View key={`code-${blocks.length}`} style={mdStyles.codeBlock}>
        <Text style={mdStyles.codeText}>
          {highlightCode(codeBlockLines.join('\n'), codeBlockLang)}
        </Text>
      </View>,
    );
  }
  flushList();

  return <View style={style}>{blocks}</View>;
});

const mdStyles = StyleSheet.create({
  text: {
    color: theme.centerChannelColor,
    fontSize: 15,
    lineHeight: 21,
    flexWrap: 'wrap',
  },
  bold: {
    fontWeight: '700',
  },
  italic: {
    fontStyle: 'italic',
  },
  strike: {
    textDecorationLine: 'line-through',
  },
  inlineCode: {
    fontFamily: 'monospace',
    fontSize: 13,
    backgroundColor: changeOpacity(theme.centerChannelColor, 0.1),
    color: changeOpacity(theme.centerChannelColor, 0.85),
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  codeBlock: {
    backgroundColor: changeOpacity(theme.centerChannelColor, 0.08),
    borderRadius: 6,
    padding: 10,
    marginVertical: 4,
    borderLeftWidth: 3,
    borderLeftColor: theme.linkColor,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: theme.centerChannelColor,
    lineHeight: 18,
  },
  codeToken: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: theme.centerChannelColor,
  },
  codeKeyword: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#d73a49',
    fontWeight: '600',
  },
  codeString: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#22863a',
  },
  codeComment: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#6a737d',
    fontStyle: 'italic',
  },
  codeNumber: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#005cc5',
  },
  link: {
    color: theme.linkColor,
    textDecorationLine: 'underline',
  },
  mention: {
    color: theme.mentionHighlightLink,
    fontWeight: '600',
    backgroundColor: theme.mentionHighlightBg,
  },
  channelMention: {
    color: theme.linkColor,
    fontWeight: '600',
    backgroundColor: changeOpacity(theme.linkColor, 0.15),
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: changeOpacity(theme.centerChannelColor, 0.3),
    paddingLeft: 10,
    marginVertical: 4,
    opacity: 0.85,
  },
  quoteText: {
    color: changeOpacity(theme.centerChannelColor, 0.7),
    fontSize: 15,
    lineHeight: 21,
    fontStyle: 'italic',
  },
  h1: {
    color: theme.centerChannelColor,
    fontSize: 20,
    fontWeight: '700',
    marginVertical: 4,
  },
  h2: {
    color: theme.centerChannelColor,
    fontSize: 17,
    fontWeight: '700',
    marginVertical: 3,
  },
  h3: {
    color: theme.centerChannelColor,
    fontSize: 15,
    fontWeight: '700',
    marginVertical: 2,
  },
  hr: {
    height: 1,
    backgroundColor: changeOpacity(theme.centerChannelColor, 0.2),
    marginVertical: 8,
  },
  list: {
    marginVertical: 2,
  },
  listItem: {
    flexDirection: 'row',
    marginVertical: 1,
  },
  bullet: {
    color: changeOpacity(theme.centerChannelColor, 0.6),
    width: 24,
    fontSize: 15,
  },
  listText: {
    color: theme.centerChannelColor,
    fontSize: 15,
    lineHeight: 21,
    flex: 1,
    flexWrap: 'wrap',
  },
  table: {
    marginVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: changeOpacity(theme.centerChannelColor, 0.3),
    borderRadius: 4,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: changeOpacity(theme.centerChannelColor, 0.3),
  },
  tableHeaderCell: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: changeOpacity(theme.centerChannelColor, 0.1),
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: changeOpacity(theme.centerChannelColor, 0.3),
  },
  tableHeaderText: {
    color: theme.centerChannelColor,
    fontSize: 13,
    fontWeight: '700',
  },
  tableCell: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: changeOpacity(theme.centerChannelColor, 0.3),
  },
  tableCellText: {
    color: theme.centerChannelColor,
    fontSize: 13,
    lineHeight: 18,
  },
});

export default Markdown;
