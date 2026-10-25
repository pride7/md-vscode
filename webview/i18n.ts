export interface Strings {
  placeholder: string;
  text: string;
  textGroup: string;
  heading: (level: number) => string;
  quote: string;
  divider: string;
  listGroup: string;
  bulletList: string;
  orderedList: string;
  taskList: string;
  advancedGroup: string;
  image: string;
  codeBlock: string;
  table: string;
  math: string;
  searchLanguage: string;
  noResult: string;
  copy: string;
  edit: string;
  hide: string;
  preview: string;
  loading: string;
  linkPlaceholder: string;
  uploadFile: string;
  upload: string;
  orPasteLink: string;
  caption: string;
  frontMatter: string;
}

const en: Strings = {
  placeholder: "Type '/' for commands",
  text: 'Text',
  textGroup: 'Text',
  heading: (level) => `Heading ${level}`,
  quote: 'Quote',
  divider: 'Divider',
  listGroup: 'List',
  bulletList: 'Bullet List',
  orderedList: 'Ordered List',
  taskList: 'Task List',
  advancedGroup: 'Advanced',
  image: 'Image',
  codeBlock: 'Code',
  table: 'Table',
  math: 'Math',
  searchLanguage: 'Search language',
  noResult: 'No result',
  copy: 'Copy',
  edit: 'Edit',
  hide: 'Hide',
  preview: 'Preview',
  loading: 'Loading…',
  linkPlaceholder: 'Paste link…',
  uploadFile: 'Upload file',
  upload: 'Upload',
  orPasteLink: 'or paste link',
  caption: 'Write image caption',
  frontMatter: 'Front matter (edit in source view)',
};

const zhCN: Strings = {
  placeholder: '输入 / 唤出命令菜单',
  text: '正文',
  textGroup: '文本',
  heading: (level) => `${level} 级标题`,
  quote: '引用',
  divider: '分割线',
  listGroup: '列表',
  bulletList: '无序列表',
  orderedList: '有序列表',
  taskList: '任务列表',
  advancedGroup: '高级',
  image: '图片',
  codeBlock: '代码块',
  table: '表格',
  math: '公式',
  searchLanguage: '搜索语言',
  noResult: '无结果',
  copy: '复制',
  edit: '编辑',
  hide: '隐藏',
  preview: '预览',
  loading: '加载中…',
  linkPlaceholder: '粘贴链接…',
  uploadFile: '上传文件',
  upload: '上传',
  orPasteLink: '或粘贴链接',
  caption: '添加图片说明',
  frontMatter: 'Front Matter 元数据（请在源码视图中编辑）',
};

export function getStrings(language: string): Strings {
  return language.toLowerCase().startsWith('zh') ? zhCN : en;
}
