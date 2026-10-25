import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextStyle from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: { setFontSize: (size: string) => ReturnType; unsetFontSize: () => ReturnType };
    lineHeight: { setLineHeight: (v: string) => ReturnType; unsetLineHeight: () => ReturnType };
  }
}

/** Font size in pt (matches the PDF export). Stored on the textStyle mark. */
export const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el) => (el as HTMLElement).style.fontSize || null,
          renderHTML: (a) => (a['fontSize'] ? { style: `font-size: ${a['fontSize']}` } : {}),
        },
      },
    }];
  },
  addCommands() {
    return {
      setFontSize: (size) => ({ chain }) => chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

/** Line spacing per block (interlineado). */
export const LineHeight = Extension.create({
  name: 'lineHeight',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: (el) => (el as HTMLElement).style.lineHeight || null,
          renderHTML: (a) => (a['lineHeight'] ? { style: `line-height: ${a['lineHeight']}` } : {}),
        },
      },
    }];
  },
  addCommands() {
    const types = ['paragraph', 'heading'];
    return {
      setLineHeight: (v) => ({ commands }) => types.map((t) => commands.updateAttributes(t, { lineHeight: v })).some(Boolean),
      unsetLineHeight: () => ({ commands }) => types.map((t) => commands.resetAttributes(t, 'lineHeight')).some(Boolean),
    };
  },
});

const cellBg = {
  cellStyle: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('style') || null,
    renderHTML: (a: Record<string, any>) => (a['cellStyle'] ? { style: a['cellStyle'] } : {}),
  },
};

const SizedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute('width') || (el as HTMLElement).style.width?.replace('px', '') || null,
        renderHTML: (a) => (a['width'] ? { width: a['width'] } : {}),
      },
    };
  },
});

export const buildExtensions = (placeholder: string) => [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, codeBlock: {} }),
  Underline,
  TextStyle,
  FontFamily,
  FontSize,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  LineHeight,
  Subscript,
  Superscript,
  Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
  SizedImage.configure({ inline: true, allowBase64: false }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellBg }; } }),
  TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellBg }; } }),
  Placeholder.configure({ placeholder }),
];
