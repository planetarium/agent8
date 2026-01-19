export interface Template {
  name: string;
  label: string;
  description: string;
  githubRepo: string;
  path: string;
  tags?: string[];
  icon?: string;
}

export interface TemplateSelection {
  templateName: string;
  title: string;
  projectRepo: string;
  nextActionSuggestion?: string;
}

export interface TemplateSelectionResponse extends TemplateSelection {
  template: Template | undefined;
}
