export interface ChapterMeta {
  title: string;
  slug: string;
  level: string;
  module: string;
  order: number;
  readingTimeMin: number;
  concepts: string[];
  useCases: string[];
  prerequisites: string[];
  status: string;
}

export interface Chapter extends ChapterMeta {
  body: string;
}

export interface ModuleNode {
  module: string;
  chapters: ChapterMeta[];
}

export interface LevelNode {
  level: string;
  modules: ModuleNode[];
}
